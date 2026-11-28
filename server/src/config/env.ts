// The one module that reads `process.env`. Every getter reads at call time and takes the environment as an
// argument, so a test passes its own.
import path from 'node:path';
import type { SettingsFile } from '@mcp-router/shared';
import { AUTH_DEFAULTS, type AuthSettings, DATABASE_DEFAULTS, HTTP_DEFAULTS } from '../core/defaults.ts';
import { isPrivateHost } from '../db/ssl.ts';

/** The token `.env.example` used to ship with, which protects nothing once it is public. */
const PLACEHOLDER_TOKEN = 'change-me';

/** The highest TCP port number. */
const MAX_PORT = 65_535;

/** Where installed server packages and caches live when `DATA_DIR` is unset. */
const DEFAULT_DATA_DIR = './data';

/** A `DATABASE_URL` that names a Postgres server. */
const POSTGRES_URL = /^postgres(ql)?:\/\//i;

/** The values of a switch variable that turn it on. */
const TRUTHY_ENV = new Set(['1', 'true', 'yes', 'on']);

/** The values of a switch variable that turn it off. */
const FALSY_ENV = new Set(['0', 'false', 'no', 'off']);

/** A hop count: digits only. */
const HOP_COUNT = /^\d+$/;

/** What signs sessions when `BETTER_AUTH_SECRET` is unset. Boot refuses it in production. */
export const DEV_SECRET = 'dev-secret-change-me-in-production';

/** The value `.env.example` ships. Public, so as good as no secret at all. */
export const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/** The id the OIDC provider is registered under in better-auth, and so the last part of its callback path. */
export const OIDC_PROVIDER_ID = 'oidc';

/** The `OIDC_CLIENT_AUTH` values a provider can expect. */
export const OIDC_CLIENT_AUTH_METHODS = ['client_secret_basic', 'client_secret_post'] as const;

/**
 * Reads a millisecond duration from an env value.
 *
 * @param value - Raw env value.
 * @param fallback - Used when the value is unset, not a whole number, or below `min`.
 * @param min - Smallest accepted value.
 * @returns The duration in ms.
 */
function envMs(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value?.trim() || Number.NaN);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Reads an on/off switch variable.
 *
 * @param value - The raw env value.
 * @returns True for 1, true, yes or on, in any case.
 */
function envFlag(value: string | undefined): boolean {
  return value !== undefined && TRUTHY_ENV.has(value.trim().toLowerCase());
}

/**
 * The directory installed server packages and caches live in: `DATA_DIR`, or `./data`.
 *
 * @param [env] - The process environment.
 * @returns The absolute path.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.DATA_DIR ?? DEFAULT_DATA_DIR);
}

/**
 * The port to listen on: `PORT` when it is set, otherwise the one in the stored settings.
 *
 * @param settingsPort - The port from the stored settings.
 * @param [env] - The process environment.
 * @returns The port number.
 * @throws When `PORT` is set to something that is not a port number.
 */
export function listenPort(settingsPort: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw === '') {
    return settingsPort;
  }
  const port = Number(raw);
  const isPort = Number.isInteger(port) && port >= 0 && port <= MAX_PORT;
  if (isPort === false) {
    throw new Error(`PORT is "${raw}", which is not a port number. Set it to a whole number from 0 to ${MAX_PORT}.`);
  }
  return port;
}

/**
 * The interface to bind: `HOST` when it is set, otherwise the one in the stored settings.
 *
 * @param settingsHost - The host from the stored settings.
 * @param [env] - The process environment.
 * @returns The host, or undefined to bind every interface.
 */
export function listenHost(settingsHost: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HOST ?? settingsHost;
}

/**
 * Where a browser reaches the router: the OIDC sign-in starts, returns and lands here, and a remote server's OAuth
 * sign-in comes back here.
 *
 * @param settings - The stored settings, for `publicUrl` and `port`.
 * @param [env] - The process environment, for `PORT`.
 * @returns `publicUrl` without a trailing slash, or this router's own localhost address.
 */
export function routerUrl(
  settings: Pick<SettingsFile, 'publicUrl' | 'port'>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = settings.publicUrl?.trim().replace(/\/+$/, '') ?? '';
  return configured === '' ? `http://localhost:${listenPort(settings.port, env)}` : configured;
}

/**
 * Whether the router is on a trusted network (`SECURE_LOCAL_NET`): whoever opens the UI is signed in as the local
 * admin, with no provider. It never opens /mcp, /graphql or /admin/mcp to a request without a credential: MCP clients
 * and agents still need an API key.
 *
 * @param [env] - The process environment.
 * @returns True when the variable is set to a truthy value. Boot refuses it when the router's address is public.
 */
export function secureLocalNet(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SECURE_LOCAL_NET === undefined ? AUTH_DEFAULTS.secureLocalNet : envFlag(env.SECURE_LOCAL_NET);
}

/**
 * Whether a public router address is accepted alongside `SECURE_LOCAL_NET`.
 *
 * @param [env] - The process environment.
 * @returns `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC` as a switch, off when unset.
 */
export function allowsPublicLocalNet(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env.I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC);
}

/**
 * How far to believe `X-Forwarded-For`, from `TRUST_PROXY`.
 *
 * @param [env] - The process environment.
 * @returns false (the default), true, a hop count, or a value Express's `trust proxy` accepts (`loopback`, a subnet).
 *
 * @remarks
 * The sign-in throttle keys on `req.ip`: behind an untrusted proxy every client shares one budget, and trusting a hop
 * that isn't a proxy lets a client pick its own address.
 */
export function trustProxy(env: NodeJS.ProcessEnv = process.env): boolean | number | string {
  const value = (env.TRUST_PROXY ?? '').trim();
  const normalised = value.toLowerCase();
  if (value === '' || FALSY_ENV.has(normalised)) {
    return false;
  }
  if (HOP_COUNT.test(value)) {
    return Number(value);
  }
  return TRUTHY_ENV.has(normalised) ? true : value;
}

/**
 * Whether the router runs as a production build: `NODE_ENV=production`, as `npm start` and the Docker image set it.
 *
 * @param [env] - The process environment.
 * @returns True in production, where GraphiQL is not served and the signing secret must be strong.
 */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * The router token from `MCP_ROUTER_TOKEN`. Boot imports it as an API key, so it keeps working on /mcp, /graphql and
 * /admin/mcp the way an agent's key does.
 *
 * @param [env] - The process environment.
 * @returns The token, or undefined when the variable is unset or empty (compose passes an unset variable as '').
 */
export function envToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MCP_ROUTER_TOKEN?.trim() || undefined;
}

/**
 * Says why a secret must not sign production sessions.
 *
 * @param secret - `BETTER_AUTH_SECRET` as set.
 * @returns The reason, as the end of a sentence ("is not set"), or undefined when it may.
 */
export function describeWeakSecret(secret: string | undefined): string | undefined {
  if (secret === undefined || secret === '') {
    return 'is not set';
  }
  if (secret === DEV_SECRET || secret === PLACEHOLDER_SECRET) {
    return 'is a published default';
  }
  if (secret.length < AUTH_DEFAULTS.minSecretLength) {
    return `is shorter than ${AUTH_DEFAULTS.minSecretLength} characters`;
  }
  return undefined;
}

/**
 * `BETTER_AUTH_SECRET` exactly as set, for boot to judge.
 *
 * @param [env] - The process environment.
 * @returns The secret, or undefined when unset.
 */
export function configuredAuthSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.BETTER_AUTH_SECRET;
}

/**
 * What better-auth signs sessions with.
 *
 * @param [env] - The process environment.
 * @returns `BETTER_AUTH_SECRET`, or the development secret when unset.
 */
export function authSecret(env: NodeJS.ProcessEnv = process.env): string {
  return configuredAuthSecret(env) || DEV_SECRET;
}

/** An OpenID Connect provider to sign in with: heautou, Keycloak, Authentik, ... */
export interface OidcConfig {
  /** The issuer URL, no trailing slash. Its discovery document is `/.well-known/openid-configuration` under it. */
  issuer: string;
  clientId: string;
  /** Unset for a public client, which proves itself with PKCE alone. */
  clientSecret: string | undefined;
  /** How a confidential client sends its secret. The provider must expect the same. */
  clientAuth: AuthSettings['oidcClientAuth'];
  /** What the login page's button calls the provider. */
  name: string;
}

/**
 * Reads the OIDC provider set in the environment.
 *
 * @param [env] - The process environment.
 * @returns The provider when `OIDC_ISSUER` and `OIDC_CLIENT_ID` are both set, otherwise null.
 *
 * @remarks
 * `refuseBadAuthConfig` refuses one of the two without the other, and an `OIDC_CLIENT_AUTH` it does not know.
 */
export function oidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim() ?? '';
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? '';
  if (issuer === '' || clientId === '') {
    return null;
  }
  const clientAuth = env.OIDC_CLIENT_AUTH?.trim();
  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET?.trim() || undefined,
    clientAuth: clientAuth === 'client_secret_post' ? clientAuth : AUTH_DEFAULTS.oidcClientAuth,
    name: env.OIDC_NAME?.trim() || AUTH_DEFAULTS.oidcName,
  };
}

/**
 * Names the address to register with the OIDC provider as this client's redirect URI.
 *
 * @param baseUrl - The router's address, from `routerUrl`.
 * @returns better-auth's callback for the provider, under it.
 */
export function oidcRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/auth/callback/${OIDC_PROVIDER_ID}`;
}

/**
 * Idle time before an inbound keep-alive connection is closed: `HTTP_KEEP_ALIVE_TIMEOUT_MS`, or the default.
 *
 * @param [env] - The process environment. `0` never closes an idle connection.
 * @returns The timeout in ms.
 */
export function keepAliveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, HTTP_DEFAULTS.keepAliveTimeoutMs, 0);
}

/**
 * Idle time before an outbound connection is closed: `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS`, or the default.
 *
 * @param [env] - The process environment. The default applies when the value is not a positive whole number.
 * @returns The timeout in ms.
 */
export function outboundKeepAliveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS, HTTP_DEFAULTS.outboundKeepAliveTimeoutMs, 1);
}

/**
 * The router's Postgres: `DATABASE_URL`, which must be a postgres:// or postgresql:// URL. Boot reads it first, so a
 * router with no database fails with a sentence before it opens anything.
 *
 * @param [env] - The process environment.
 * @returns The URL, trimmed.
 * @throws When `DATABASE_URL` is unset, empty, or not a Postgres URL.
 */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim() ?? '';
  if (url === '') {
    throw new Error(
      '[db] DATABASE_URL is not set. The router stores its config in Postgres: set it to a postgres:// URL, such as ' +
        'postgres://mcp_router:secret@postgres:5432/mcp_router (docker-compose.yml runs one beside the router).',
    );
  }
  if (POSTGRES_URL.test(url) === false) {
    // The scheme only: the rest may hold a password.
    const scheme = url.includes('://') ? `${url.split('://')[0]}://` : 'a path';
    throw new Error(
      `[db] DATABASE_URL must be a postgres:// or postgresql:// URL, not ${scheme}. The router runs on Postgres only.`,
    );
  }
  return url;
}

/**
 * How long boot waits for Postgres: `DB_CONNECT_TIMEOUT_MS`, or the default.
 *
 * @param [env] - The process environment. The default applies when the value is not a positive whole number.
 * @returns The timeout in ms.
 */
export function dbConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.DB_CONNECT_TIMEOUT_MS, DATABASE_DEFAULTS.connectTimeoutMs, 1);
}

/**
 * Refuses a misconfiguration of sign-in before anything opens: the placeholder token, a weak signing secret in
 * production, and half an OIDC setup.
 *
 * @param [env] - The process environment.
 * @throws With a sentence saying what to fix.
 */
export function refuseBadAuthConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (envToken(env) === PLACEHOLDER_TOKEN) {
    throw new Error(
      `MCP_ROUTER_TOKEN is still the placeholder "${PLACEHOLDER_TOKEN}", which would become an API key anyone can ` +
        'guess. Remove it and create an API key in Settings, or set it to a long random value (openssl rand -hex 32).',
    );
  }
  if (isProduction(env)) {
    // A known or guessable secret lets anyone forge a session.
    const weakness = describeWeakSecret(configuredAuthSecret(env));
    if (weakness !== undefined) {
      throw new Error(
        `BETTER_AUTH_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`,
      );
    }
  }
  // Half an OIDC setup leaves the sign-in page without its button and no clue why.
  const issuer = env.OIDC_ISSUER?.trim() ?? '';
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? '';
  if ((issuer === '') !== (clientId === '')) {
    throw new Error(
      'OIDC_ISSUER and OIDC_CLIENT_ID go together: set both to sign in with an OIDC provider, or neither.',
    );
  }
  if (issuer !== '' && URL.canParse(issuer) === false) {
    throw new Error(`OIDC_ISSUER is not a URL: ${issuer}`);
  }
  const clientAuth = env.OIDC_CLIENT_AUTH?.trim() ?? '';
  const isKnownClientAuth = OIDC_CLIENT_AUTH_METHODS.some((method) => method === clientAuth);
  if (clientAuth !== '' && isKnownClientAuth === false) {
    throw new Error(`OIDC_CLIENT_AUTH must be one of ${OIDC_CLIENT_AUTH_METHODS.join(', ')}.`);
  }
}

/**
 * Says whether `SECURE_LOCAL_NET` may sign people in at a router address: whoever opens the UI is the admin, so the
 * network must be the router's own.
 *
 * @param baseUrl - The router's address, from `routerUrl`.
 * @param [env] - The process environment.
 * @returns An error to refuse with, or undefined when the address is private, `SECURE_LOCAL_NET` is off, or
 * `I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC` is set.
 */
export function publicLocalNetError(baseUrl: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (secureLocalNet(env) === false || allowsPublicLocalNet(env)) {
    return undefined;
  }
  const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateHost(hostname)) {
    return undefined;
  }
  return (
    `SECURE_LOCAL_NET is on but the router's address (${baseUrl}, its publicUrl) is not a private address. Turn ` +
    'SECURE_LOCAL_NET off, or set I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC=true if nothing hostile can reach this port.'
  );
}
