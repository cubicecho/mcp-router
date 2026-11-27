import type { ApiDeps } from '../api/deps.ts';
import type { DB } from '../db/client.ts';

/** What `Context.ip` holds when the socket reports no address. */
export const UNKNOWN_IP = 'unknown';

/** The person who runs the router. Today the only kind of caller: whoever holds the bearer token. */
export const CALLER_OPERATOR = 'operator' as const;

/** Kind of caller. Permissions are keyed on it; a later auth step adds API-key callers beside the operator. */
export type Caller = typeof CALLER_OPERATOR;

/** What every request's context carries, whoever the caller is. The REST routes are built over the same set. */
export interface ContextDeps extends ApiDeps {
  /** The tables the generated schema and the hand-written writes read and write. */
  db: DB;
  /** When the router started, in ms since the epoch; `routerStatus` counts uptime from it. */
  startedAt: number;
}

/** What every resolver, generated or hand-written, is handed: on /graphql and /admin/mcp alike. */
export interface Context extends ContextDeps {
  /** null for nobody, which permissions refuse everywhere. */
  caller: Caller | null;
  /** The request's headers, where a later auth step reads a session or an API key. */
  headers: Headers;
  /** The client's address as Express resolved it. Never an identity. */
  ip: string;
}

/**
 * Builds one request's context.
 *
 * @param headers - Request headers.
 * @param [ip] - Client address from Express's `req.ip`.
 * @returns The context.
 */
export type ContextFactory = (headers: Headers, ip?: string) => Promise<Context>;

/**
 * Builds the context factory both doors use, so /graphql and /admin/mcp read the caller the same way.
 *
 * @param deps - What every resolver talks to.
 * @returns The factory.
 *
 * @remarks
 * Both doors sit behind the bearer-token guard (`auth/middleware.ts`), the same one as /api, so a request that reaches
 * the factory is the operator's: the token, or `SECURE_LOCAL_NET`, already said so. A later auth step reads a
 * better-auth session or an API key from `headers` here and returns null for neither.
 */
export function createContextFactory(deps: ContextDeps): ContextFactory {
  return async (headers, ip = UNKNOWN_IP) => ({ ...deps, caller: CALLER_OPERATOR, headers, ip });
}
