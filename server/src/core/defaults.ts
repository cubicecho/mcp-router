// Every fixed value someone might tune, as plain data. Nothing here computes, reads the environment or imports.
// What an operator can change at run time lives in settings.json (`SETTINGS_DEFAULTS` in the shared package).

/** Settings for the HTTP doors. */
export interface HttpSettings {
  /** Idle time before an inbound keep-alive connection is closed, in ms. Above the 60 s nginx and ALB hold theirs. `HTTP_KEEP_ALIVE_TIMEOUT_MS` overrides it. */
  keepAliveTimeoutMs: number;
  /** Idle time before an outbound connection is closed when the remote names none, in ms. Below the 60 s most servers allow. `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS` overrides it. */
  outboundKeepAliveTimeoutMs: number;
  /** Largest JSON body /api and /mcp accept, as `express.json` reads it. */
  bodyLimit: string;
  /** How long in-flight requests get to finish after a stop signal, in seconds. Open streams are cut after it. */
  drainSeconds: number;
  /** How long the whole shutdown may take before the process exits anyway, in seconds. Under the 10 s Docker waits before SIGKILL. */
  shutdownDeadlineSeconds: number;
}

export const HTTP_DEFAULTS: Readonly<HttpSettings> = Object.freeze({
  keepAliveTimeoutMs: 75_000,
  outboundKeepAliveTimeoutMs: 30_000,
  bodyLimit: '4mb',
  drainSeconds: 5,
  shutdownDeadlineSeconds: 8,
});

/** Settings for the config files under DATA_DIR/config. */
export interface ConfigSettings {
  /** How long config-file changes are gathered before one reload, in ms. */
  watchDebounceMs: number;
  /** Random bytes in a generated auth token. It is stored as twice as many hex characters. */
  authTokenBytes: number;
}

export const CONFIG_DEFAULTS: Readonly<ConfigSettings> = Object.freeze({
  watchDebounceMs: 300,
  authTokenBytes: 32,
});

/** Settings for the downstream connections and the MCP sessions in front of them. */
export interface GatewaySettings {
  /** How long a crashed server refuses a new connect, in ms. */
  crashBackoffMs: number;
  /** Events buffered per stream and session for a client that reconnects. Enough for a brief gap. */
  maxBufferedEvents: number;
  /** Delay before TCP keepalive probes start on a held GET SSE stream, in ms. */
  streamKeepAliveMs: number;
  /** Pages read from one paginated listing, against a downstream that never stops returning cursors. */
  maxListPages: number;
}

export const GATEWAY_DEFAULTS: Readonly<GatewaySettings> = Object.freeze({
  crashBackoffMs: 5_000,
  maxBufferedEvents: 256,
  streamKeepAliveMs: 60_000,
  maxListPages: 100,
});

/** Settings for the in-memory activity log. */
export interface ActivitySettings {
  /** Entries kept per server. The oldest are dropped past it. */
  maxEntries: number;
  /** Longest stored params, result, error or target, in characters. Longer ones are cut. */
  valueMaxChars: number;
}

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

export const INSTALL_DEFAULTS: Readonly<InstallSettings> = Object.freeze({
  npmTimeoutMs: 300_000,
  stderrTailChars: 1_000,
});
