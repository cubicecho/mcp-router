import { apiKey } from '@better-auth/api-key';
import { API_KEY_MAX_EXPIRES_IN_DAYS, API_KEY_NAME_MAX_LENGTH, SECONDS_PER_DAY } from '@mcp-router/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth, oneTimeToken } from 'better-auth/plugins';
import { authSecret, OIDC_PROVIDER_ID, type OidcConfig, oidcConfig } from '../config/env.ts';
import { AUTH_DEFAULTS, KEY_DEFAULTS } from '../core/defaults.ts';
import type { DB } from '../db/client.ts';
import { accounts, apikeys, sessions, users, verifications } from '../db/schema.ts';
import { Role } from '../db/tables/users.ts';
import { claimFirstAdmin } from './admin.ts';

/** What every key the router mints starts with, so a leaked one is recognisable as the router's. */
export const KEY_PREFIX = 'mcpr_';

/**
 * What better-auth logs when a presented API key does not hold. A refused key is an ordinary 401 here (and every
 * bearer that is not a session is tried as a key), so it is not logged.
 */
const REFUSED_KEY_LOG = 'Failed to validate API key';

/** A level better-auth logs at. */
type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Writes better-auth's log lines with the `[auth]` tag, leaving out refused API keys.
 *
 * @param level - better-auth's level.
 * @param message - The line.
 * @param args - What better-auth logs with it.
 */
function logAuth(level: AuthLogLevel, message: string, ...args: unknown[]): void {
  if (message.startsWith(REFUSED_KEY_LOG)) {
    return;
  }
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  write(`[auth] ${message}`, ...args);
}

/** Who better-auth's instance is for: the router's address, and test overrides. */
export interface AuthOptions {
  /**
   * Where a browser reaches the router (`routerUrl`): the OIDC callback is served under it, and sign-ins land on its
   * pages.
   */
  baseUrl: string;
  /** What better-auth signs with. The default is `authSecret()`. */
  secret?: string;
  /** The OIDC provider to sign in with, or null for none. The default is `oidcConfig()`, the environment's. */
  oidc?: OidcConfig | null;
}

/**
 * Builds the better-auth instance. Server code calls `auth.api.*`, and none of its REST routes are mounted.
 *
 * @param db - The database users, sessions and API keys are kept in.
 * @param options - The router's address, and test overrides.
 * @returns The auth instance.
 */
export function createAuth(db: DB, { baseUrl, secret = authSecret(), oidc = oidcConfig() }: AuthOptions) {
  return betterAuth({
    // The rc drizzle instance is keyed by relations, so the adapter cannot discover tables itself.
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications, apikey: apikeys },
    }),
    secret,
    // The OIDC callback is served here (http/sso.ts).
    baseURL: baseUrl,
    trustedOrigins: [new URL(baseUrl).origin],
    advanced: { database: { generateId: 'uuid' } },
    session: { expiresIn: AUTH_DEFAULTS.sessionTtlDays * SECONDS_PER_DAY },
    // So a session carries its user's role, and reading the caller costs one lookup.
    user: { additionalFields: { role: { type: 'string', input: false, defaultValue: Role.User } } },
    // Every way an account is made goes through better-auth's adapter, so this is where the first becomes admin.
    databaseHooks: { user: { create: { after: async (user) => claimFirstAdmin(db, user.id) } } },
    // An address the router's own provider vouches for signs in to the account that has it.
    ...(oidc ? { account: { accountLinking: { requireLocalEmailVerified: false } } } : {}),
    // Where an OIDC callback goes when it cannot tell where the sign-in came from.
    onAPIError: { errorURL: `${baseUrl}/login` },
    logger: { log: logAuth },
    plugins: [
      // The UI sends its session back as `Authorization: Bearer`.
      bearer(),
      // How an OIDC sign-in reaches the UI: the callback mints one, and /auth/sso spends it over GraphQL.
      oneTimeToken({
        expiresIn: AUTH_DEFAULTS.oneTimeTokenTtlMinutes,
        storeToken: 'hashed',
        disableClientRequest: true,
        disableSetSessionCookie: true,
      }),
      // Machine callers. Keys live in Postgres (the default storage), so they survive restarts. The plugin's per-key
      // rate limit (10 a day by default) would starve an MCP client, so it is off.
      apiKey({
        enableMetadata: true,
        defaultPrefix: KEY_PREFIX,
        defaultKeyLength: KEY_DEFAULTS.length,
        rateLimit: { enabled: false },
        maximumNameLength: API_KEY_NAME_MAX_LENGTH,
        keyExpiration: { maxExpiresIn: API_KEY_MAX_EXPIRES_IN_DAYS },
      }),
      ...(oidc ? [oidcPlugin(oidc)] : []),
    ],
  });
}

/** The better-auth instance `createAuth` builds. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * The OIDC provider, through better-auth's generic OAuth plugin, which runs the flow (state, PKCE, nonce).
 *
 * @param oidc - The provider.
 * @returns The plugin.
 */
function oidcPlugin(oidc: OidcConfig) {
  return genericOAuth({
    config: [
      {
        providerId: OIDC_PROVIDER_ID,
        name: oidc.name,
        discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
        requireIdTokenVerification: true,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        tokenEndpointAuth: { method: oidc.clientSecret ? oidc.clientAuth : 'none' },
        pkce: true,
        scopes: ['openid', 'profile', 'email'],
        // A provider may release only a username, or no name at all.
        mapProfileToUser: (profile) => ({
          name:
            stringClaim(profile.name) ??
            stringClaim(profile.preferred_username) ??
            stringClaim(profile.email)?.split('@')[0] ??
            '',
        }),
      },
    ],
  });
}

/**
 * Reads a claim that should be text.
 *
 * @param value - The claim as the provider sent it.
 * @returns The text, or undefined when it is missing, blank or not a string.
 */
function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Who a live session belongs to. */
export interface SessionUser {
  userId: string;
  role: Role;
}

/**
 * Reads who a request's session belongs to.
 *
 * @param auth - The auth instance.
 * @param headers - The request's headers, carrying `Authorization: Bearer`.
 * @returns The user and their role, or null when there is no live session.
 */
export async function sessionUser(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (session === null) {
    return null;
  }
  const role = session.user.role === Role.Admin ? Role.Admin : Role.User;
  return { userId: session.user.id, role };
}
