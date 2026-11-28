import type { RequestHandler } from 'express';
import type { Identity } from '../core/context.ts';
import { badInput, errorMessage, forbidden, sendError, unauthenticated } from '../core/errors.ts';
import type { AuthHost } from './auth-host.ts';
import type { Auth } from './better-auth.ts';
import { ConflictingKeysError, readCaller, readKeyCaller } from './caller.ts';

/** What a request to the proxied MCP endpoints without a live key is told. */
const NEEDS_KEY = 'Send an API key as Authorization: Bearer <key>, or x-api-key. Create one in Settings.';

/**
 * Tells whether an origin is a loopback one, which a remote attacker cannot forge.
 *
 * @param origin - An `Origin` header value.
 * @returns True for localhost, 127.0.0.1 or ::1 on any port; false for anything else, an unparsable value included.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Builds the DNS-rebinding guard for /mcp, which rejects a disallowed `Origin` with 403.
 *
 * @param getAllowedOrigins - The operator-configured origins, read on every request.
 * @returns Middleware that passes requests with no Origin, a loopback one or an allowed one.
 *
 * @remarks
 * Browsers attach an `Origin` header a page cannot spoof, so a rebound request from a malicious site carries that
 * site's origin. Native MCP clients send no Origin at all.
 */
export function createOriginMiddleware(getAllowedOrigins: () => string[]): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.origin;
    const origin = Array.isArray(header) ? header[0] : header;
    if (!origin || isLoopbackOrigin(origin) || getAllowedOrigins().includes(origin)) {
      next();
      return;
    }
    sendError(res, forbidden(`Origin "${origin}" is not allowed`));
  };
}

/**
 * Copies Express's headers into fetch `Headers`, which better-auth reads.
 *
 * @param raw - The request's headers as Express parsed them.
 * @returns The same headers, repeated ones appended.
 */
export function toFetchHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const one of [value ?? []].flat()) {
      headers.append(name, one);
    }
  }
  return headers;
}

/** Reads who a request is from, for a guard. */
type ReadIdentity = (auth: Auth, headers: Headers) => Promise<Identity>;

/**
 * Builds a guard that answers a request with no live credential with 401, before the door's own handler.
 *
 * @param authHost - Where the current auth instance is.
 * @param read - Which credentials the door takes.
 * @param refusal - What a request without one is told.
 * @returns The middleware. Two different keys in one request are a 400.
 */
function credentialGuard(authHost: AuthHost, read: ReadIdentity, refusal: string): RequestHandler {
  return (req, res, next) => {
    read(authHost.current(), toFetchHeaders(req.headers))
      .then((identity) => {
        if (identity.caller === null) {
          sendError(res, unauthenticated(refusal));
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof ConflictingKeysError) {
          sendError(res, badInput(error.message));
          return;
        }
        next(new Error(`Could not check the credential: ${errorMessage(error)}`, { cause: error }));
      });
  };
}

/**
 * Builds the API-key guard for the proxied MCP endpoints (/mcp, /mcp/<name>, /mcp/w/<slug>).
 *
 * @param authHost - Where the current auth instance is, whose api-key plugin checks the key.
 * @returns Middleware that passes a request with a live API key, in `Authorization: Bearer` or `x-api-key`, and answers
 * anything else with the JSON error envelope: 401 for no key or a dead one, 400 for two different keys.
 *
 * @remarks
 * A session never opens these, on a trusted network (SECURE_LOCAL_NET) too: MCP clients carry keys. The old router
 * token works here because boot imported it as a key.
 */
export function createApiKeyMiddleware(authHost: AuthHost): RequestHandler {
  return credentialGuard(authHost, readKeyCaller, NEEDS_KEY);
}

/**
 * Builds the guard for /admin/mcp, the router's own API as MCP tools: an API key or a session opens it, and
 * permissions decide which tools each may call.
 *
 * @param authHost - Where the current auth instance is.
 * @returns Middleware that answers a request with neither with 401, so an MCP client learns it needs a key.
 */
export function createCallerMiddleware(authHost: AuthHost): RequestHandler {
  return credentialGuard(authHost, readCaller, NEEDS_KEY);
}
