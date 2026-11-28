// Every fixed value someone might tune, as plain data. Nothing here computes, reads the environment or imports.
// What an operator can change at run time lives in the settings row (`SETTINGS_DEFAULTS` in the shared package).

/** Settings for the HTTP doors. */
export interface HttpSettings {
  /**
   * Idle time before an inbound keep-alive connection is closed, in ms. Above the 60 s nginx and ALB hold theirs.
   * `HTTP_KEEP_ALIVE_TIMEOUT_MS` overrides it.
   */
  keepAliveTimeoutMs: number;
  /**
   * Idle time before an outbound connection is closed when the remote names none, in ms. Below the 60 s most servers
   * allow. `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS` overrides it.
   */
  outboundKeepAliveTimeoutMs: number;
  /** Largest JSON body /graphql, /admin/mcp and /mcp accept, as `express.json` reads it. */
  bodyLimit: string;
  /** How long in-flight requests get to finish after a stop signal, in seconds. Open streams are cut after it. */
  drainSeconds: number;
  /**
   * How long the whole shutdown may take before the process exits anyway, in seconds. Under the 10 s Docker waits
   * before SIGKILL.
   */
  shutdownDeadlineSeconds: number;
}

/** The fixed HTTP settings this build ships with. */
export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  keepAliveTimeoutMs: 75_000,
  outboundKeepAliveTimeoutMs: 30_000,
  bodyLimit: '4mb',
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
});

/** Settings for the sign-in throttle. */
export interface RateLimitSettings {
  /** Failed attempts allowed per key inside one window. One that succeeds is given back. */
  maxAttempts: number;
  /** How long a failed attempt counts against its key. */
  windowMinutes: number;
  /** Past this many keys, a hit sweeps out the ones whose window has passed. */
  sweepAtKeys: number;
}

/** The fixed sign-in throttle this build ships with. */
export const RATE_LIMIT_DEFAULTS: Readonly<RateLimitSettings> = Object.freeze({
  maxAttempts: 5,
  windowMinutes: 15,
  sweepAtKeys: 10_000,
});

/** Sign-in and credential settings. */
export interface AuthSettings {
  /** How long a session lasts after it was last used. Long: there is no password to fall back on. */
  sessionTtlDays: number;
  /** Shortest signing secret production accepts, in characters. `openssl rand -hex 32` gives twice this. */
  minSecretLength: number;
  /** Whether opening the UI signs in as the local admin. `SECURE_LOCAL_NET` overrides it. */
  secureLocalNet: boolean;
  /** How long the token an OIDC callback hands the UI works: the hop from the callback to `/auth/sso`. */
  oneTimeTokenTtlMinutes: number;
  /** What the login page's OIDC button calls the provider. `OIDC_NAME` overrides it. */
  oidcName: string;
  /** How a confidential OIDC client sends its secret. `OIDC_CLIENT_AUTH` overrides it. */
  oidcClientAuth: 'client_secret_basic' | 'client_secret_post';
  /** How long pairing waits on the provider before calling it unreachable, in ms. */
  oidcPairingTimeoutMs: number;
}

/** The fixed sign-in settings this build ships with. */
export const AUTH_DEFAULTS: Readonly<AuthSettings> = Object.freeze({
  sessionTtlDays: 30,
  minSecretLength: 32,
  secureLocalNet: false,
  oneTimeTokenTtlMinutes: 3,
  oidcName: 'SSO',
  // The default the OIDC spec names.
  oidcClientAuth: 'client_secret_basic',
  oidcPairingTimeoutMs: 10_000,
});

/**
 * API keys for machine callers. The longest name and lifetime are the shared package's, since the UI's form is held to
 * them too.
 */
export interface KeySettings {
  /** Random characters in a new key, after its prefix. */
  length: number;
}

/** The fixed API key settings this build ships with. */
export const KEY_DEFAULTS: Readonly<KeySettings> = Object.freeze({
  length: 48,
});

/** Settings for reaching Postgres at boot. */
export interface DatabaseSettings {
  /** How long boot waits for Postgres before giving up, in ms. `DB_CONNECT_TIMEOUT_MS` overrides it. */
  connectTimeoutMs: number;
  /** The wait before the first retry, in ms. */
  firstRetryDelayMs: number;
  /** The longest wait between two retries, in ms. */
  maxRetryDelayMs: number;
  /** How much the wait grows after each failed attempt. */
  retryBackoffFactor: number;
}

/** The fixed database settings this build ships with. */
export const DATABASE_DEFAULTS: Readonly<DatabaseSettings> = Object.freeze({
  connectTimeoutMs: 60_000,
  firstRetryDelayMs: 500,
  maxRetryDelayMs: 5_000,
  retryBackoffFactor: 2,
});

/** Settings for the downstream connections and the MCP sessions in front of them. */
export interface GatewaySettings {
  /** How long a crashed server refuses a new connect, in ms. */
  crashBackoffMs: number;
  /** Events buffered per stream and session for a client that reconnects. Enough for a brief gap. */
  maxBufferedEvents: number;
  /** Delay before TCP keepalive probes start on a held GET SSE stream, in ms. */
  streamKeepAliveMs: number;
}

/** The fixed gateway settings this build ships with. */
export const GATEWAY_DEFAULTS: Readonly<GatewaySettings> = Object.freeze({
  crashBackoffMs: 5_000,
  maxBufferedEvents: 256,
  streamKeepAliveMs: 60_000,
});

/** Settings for the in-memory activity log. */
export interface ActivitySettings {
  /** Entries kept per server. The oldest are dropped past it. */
  maxEntries: number;
  /** Longest stored params, result, error or target, in characters. Longer ones are cut. */
  valueMaxChars: number;
}

/** The fixed activity-log settings this build ships with. */
export const ACTIVITY_DEFAULTS: Readonly<ActivitySettings> = Object.freeze({
  maxEntries: 200,
  valueMaxChars: 8_000,
});

/** Settings for calls to a registry. */
export interface RegistrySettings {
  /** How long a registry may take to answer before the request is abandoned, in ms. */
  fetchTimeoutMs: number;
  /** How much of a registry's error body is passed on as detail, in characters. */
  errorBodyMaxChars: number;
}

/** The fixed registry settings this build ships with. */
export const REGISTRY_DEFAULTS: Readonly<RegistrySettings> = Object.freeze({
  fetchTimeoutMs: 30_000,
  errorBodyMaxChars: 500,
});

/** Settings for installing a server's package. */
export interface InstallSettings {
  /** How long one `npm install` may run before it is killed, in ms. */
  npmTimeoutMs: number;
  /** How much of the end of npm's stderr is passed on as detail when it fails, in characters. */
  stderrTailChars: number;
}

/** The fixed install settings this build ships with. */
export const INSTALL_DEFAULTS: Readonly<InstallSettings> = Object.freeze({
  npmTimeoutMs: 300_000,
  stderrTailChars: 1_000,
});

/** Settings for the OAuth sign-in to remote servers. */
export interface OAuthSettings {
  /** How long a started sign-in waits for its callback before the link stops working, in ms. */
  flowTtlMs: number;
  /** How long the after-install check waits for a remote server to say whether it wants a sign-in, in ms. */
  checkTimeoutMs: number;
  /** Random bytes in a sign-in's `state`. It is sent as base64url. */
  stateBytes: number;
  /** The router's name, as a server's login shows it on its consent page. */
  clientName: string;
  /** Where the login sends the browser back to, under the router's address. */
  callbackPath: string;
  /** Where the router's client metadata document is served, under its address. Doubles as its client id. */
  clientMetadataPath: string;
}

/** The fixed OAuth settings this build ships with. */
export const OAUTH_DEFAULTS: Readonly<OAuthSettings> = Object.freeze({
  flowTtlMs: 600_000,
  checkTimeoutMs: 10_000,
  stateBytes: 32,
  clientName: 'MCP Router',
  callbackPath: '/oauth/callback',
  clientMetadataPath: '/oauth/client-metadata.json',
});

/** Bounds on one GraphQL operation. */
export interface OperationLimitSettings {
  /** Rows a list returns when the request names no `limit`. */
  defaultPageSize: number;
  /** The largest `limit` a request may ask for. */
  maxPageSize: number;
  /** Deepest selection accepted. */
  maxDepth: number;
  /** Aliases per operation. */
  maxAliases: number;
  /** Cost per operation. One full page of rows with about 10 fields fits. A page of full pages doesn't. */
  maxCost: number;
  /** What a field costs when nothing prices it. */
  defaultFieldCost: number;
}

/** The fixed GraphQL operation limits this build ships with. */
export const OPERATION_LIMIT_DEFAULTS: Readonly<OperationLimitSettings> = Object.freeze({
  defaultPageSize: 50,
  maxPageSize: 500,
  maxDepth: 8,
  maxAliases: 15,
  maxCost: 10_000,
  defaultFieldCost: 1,
});

/** Bounds on the router's own MCP door, /admin/mcp. */
export interface McpSettings {
  /** Levels of relations a tool's selection includes. Deeper pulls whole relations into the agent's context. */
  selectionDepth: number;
  /** Largest schema one tool may have, in bytes of JSON. */
  maxToolSchemaBytes: number;
  /** Largest `tools/list` response, in bytes of JSON. */
  maxToolListBytes: number;
}

/** The fixed /admin/mcp bounds this build ships with. */
export const MCP_DEFAULTS: Readonly<McpSettings> = Object.freeze({
  selectionDepth: 1,
  maxToolSchemaBytes: 40_000,
  maxToolListBytes: 250_000,
});
