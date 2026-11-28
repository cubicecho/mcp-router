import type { AuthHost } from '../auth/auth-host.ts';
import type { Auth } from '../auth/better-auth.ts';
import { readCaller } from '../auth/caller.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { ConfigStore } from '../config/store.ts';
import type { DB } from '../db/client.ts';
import type { Role } from '../db/tables/users.ts';
import type { LanServers } from '../discovery/lan-servers.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import type { OAuthService } from '../oauth/service.ts';
import type { RegistryClient } from '../registry/client.ts';

/** What `Context.ip` holds when the socket reports no address. One shared budget, not none. */
export const UNKNOWN_IP = 'unknown';

/** A person signed in to the UI, on a better-auth session. */
export const CALLER_OPERATOR = 'operator' as const;
/** A machine (an agent, an MCP client, a script), on an API key. */
export const CALLER_AGENT = 'agent' as const;

/** Kind of caller, read from the credential the request presents. Permissions are keyed on it. */
export type Caller = typeof CALLER_OPERATOR | typeof CALLER_AGENT;

/** Who a request is from, read once from its credential. */
export interface Identity {
  /** null for nobody, which permissions refuse everywhere but signing in. */
  caller: Caller | null;
  /** The signed-in person, or the user who made the key. null for nobody and for a key imported from the old token. */
  userId: string | null;
  /** The person's role. Set only for an operator. */
  role: Role | null;
  /** Set only for an API-key request. */
  keyId: string | null;
}

/** What every request's context carries, whoever the caller is. */
export interface ContextDeps {
  store: ConfigStore;
  manager: GatewayManager;
  registryClient: RegistryClient;
  /** The data directory; installed packages live under it. */
  dataDir: string;
  /** OAuth sign-in for remote servers. */
  oauth: OAuthService;
  /** The servers found on the local network. */
  lanServers: LanServers;
  /** The tables the generated schema and the hand-written writes read and write. */
  db: DB;
  /** When the router started, in ms since the epoch; `routerStatus` counts uptime from it. */
  startedAt: number;
  /** Where the current better-auth instance is. Pairing a provider, or changing `publicUrl`, rebuilds it. */
  authHost: AuthHost;
  /** Sign-in throttle. The sign-in mutations call it. */
  limiter: RateLimiter;
}

/** What every resolver, generated or hand-written, is handed: on /graphql and /admin/mcp alike. */
export interface Context extends ContextDeps, Identity {
  /** The better-auth instance for this request; the auth resolvers call `auth.api.*`. */
  auth: Auth;
  /** The request's headers. better-auth reads the session from them. */
  headers: Headers;
  /** The client's address as Express resolved it under `TRUST_PROXY`. Never an identity. */
  ip: string;
}

/**
 * Builds one request's context.
 *
 * @param headers - Request headers.
 * @param [ip] - Client address from Express's `req.ip`.
 * @returns The context.
 * @throws {@link ConflictingKeysError} When the request sends two different keys.
 */
export type ContextFactory = (headers: Headers, ip?: string) => Promise<Context>;

/**
 * Builds the context factory both doors use, so /graphql and /admin/mcp read the caller the same way.
 *
 * @param deps - What every resolver talks to.
 * @returns The factory. The caller is the operator for a live session, an agent for a live API key, and nobody
 * otherwise; permissions decide what each may call.
 */
export function createContextFactory(deps: ContextDeps): ContextFactory {
  return async (headers, ip = UNKNOWN_IP) => {
    // Asked per request: pairing a provider swaps the instance.
    const auth = deps.authHost.current();
    const identity = await readCaller(auth, headers);
    return { ...deps, ...identity, auth, headers, ip };
  };
}
