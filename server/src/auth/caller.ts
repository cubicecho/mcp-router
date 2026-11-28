import { CALLER_AGENT, CALLER_OPERATOR, type Identity } from '../core/context.ts';
import { type Auth, KEY_PREFIX, sessionUser } from './better-auth.ts';
import { IMPORTED_KEY_OWNER } from './keys.ts';

/** The header a machine caller may send its key in, beside or instead of `Authorization: Bearer`. */
export const API_KEY_HEADER = 'x-api-key';
/** The scheme a key or a session token is sent under. */
const BEARER_SCHEME = /^bearer\s+/i;

/** Nobody: no credential, or one that does not hold. */
export const ANONYMOUS: Readonly<Identity> = Object.freeze({ caller: null, userId: null, role: null, keyId: null });

/** A request that sent a key two ways, and the two differ. Each door answers it in its own format. */
export class ConflictingKeysError extends Error {
  /** Builds the error. */
  constructor() {
    super('The request sends two different keys, in Authorization and x-api-key. Send one.');
    this.name = 'ConflictingKeysError';
  }
}

/** The credentials a request presents. */
interface Presented {
  /** From `Authorization: Bearer`: an API key, or a person's session token. */
  bearer: string | null;
  /** From `x-api-key`: only ever an API key. */
  apiKey: string | null;
}

/**
 * Reads the credentials a request presents.
 *
 * @param headers - The request's headers.
 * @returns The bearer and `x-api-key` values, each null when absent or blank.
 * @throws {@link ConflictingKeysError} When both are sent and differ.
 */
function presented(headers: Headers): Presented {
  const authorization = headers.get('authorization') ?? '';
  const hasBearer = BEARER_SCHEME.test(authorization);
  const bearer = hasBearer ? authorization.replace(BEARER_SCHEME, '').trim() : '';
  const apiKey = headers.get(API_KEY_HEADER)?.trim() ?? '';
  const isConflicting = bearer !== '' && apiKey !== '' && bearer !== apiKey;
  if (isConflicting) {
    throw new ConflictingKeysError();
  }
  return { bearer: bearer === '' ? null : bearer, apiKey: apiKey === '' ? null : apiKey };
}

/**
 * Checks an API key with better-auth's api-key plugin.
 *
 * @param auth - The auth instance.
 * @param key - The key as the request sent it.
 * @returns An agent for a live key, or nobody for one that is unknown, revoked or expired.
 */
async function keyIdentity(auth: Auth, key: string): Promise<Identity> {
  const { valid, key: verified } = await auth.api.verifyApiKey({ body: { key } });
  if (valid === false || verified === null) {
    return ANONYMOUS;
  }
  const userId = verified.referenceId === IMPORTED_KEY_OWNER ? null : verified.referenceId;
  return { caller: CALLER_AGENT, userId, role: null, keyId: verified.id };
}

/**
 * Reads who a request to /graphql or /admin/mcp is from.
 *
 * @param auth - The auth instance for this request.
 * @param headers - The request's headers.
 * @returns The operator for a live session, an agent for a live API key, or nobody.
 * @throws {@link ConflictingKeysError} When the request sends two different keys.
 *
 * @remarks
 * `x-api-key` is only ever a key, and one that does not hold is nobody, never a fall through to a session. A bearer
 * that starts with the router's key prefix is a key too. Any other bearer is tried as a session first, then as a key:
 * a key imported from the old router token has no prefix.
 */
export async function readCaller(auth: Auth, headers: Headers): Promise<Identity> {
  const { bearer, apiKey } = presented(headers);
  if (apiKey !== null) {
    return keyIdentity(auth, apiKey);
  }
  if (bearer === null) {
    return ANONYMOUS;
  }
  if (bearer.startsWith(KEY_PREFIX)) {
    return keyIdentity(auth, bearer);
  }
  const user = await sessionUser(auth, headers);
  if (user !== null) {
    return { caller: CALLER_OPERATOR, userId: user.userId, role: user.role, keyId: null };
  }
  return keyIdentity(auth, bearer);
}

/**
 * Reads the machine caller a request to the proxied MCP endpoints is from, by its API key alone. A session is never
 * read there, on a trusted network too: MCP clients carry keys.
 *
 * @param auth - The auth instance for this request.
 * @param headers - The request's headers.
 * @returns An agent for a live key, or nobody.
 * @throws {@link ConflictingKeysError} When the request sends two different keys.
 */
export async function readKeyCaller(auth: Auth, headers: Headers): Promise<Identity> {
  const { bearer, apiKey } = presented(headers);
  const candidate = apiKey ?? bearer;
  return candidate === null ? ANONYMOUS : keyIdentity(auth, candidate);
}
