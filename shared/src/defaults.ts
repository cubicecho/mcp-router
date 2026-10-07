// The values the config contract falls back to or is bounded by, as plain data.
// Nothing here computes, reads the environment or imports.

/** What settings.json means when a key is absent. */
export interface RouterSettings {
  /** The port to listen on. `PORT` overrides it. */
  port: number;
  /** How long an unused stdio child runs before it is stopped, in ms. A server's own `idleTimeoutMs` overrides it. */
  idleTimeoutMs: number;
  /** How long an MCP session may go unused before the router reclaims it, in ms. */
  sessionIdleTimeoutMs: number;
  /** Live MCP sessions kept at once. The least recently active are dropped past it. */
  maxSessions: number;
  /** How long a spawn plus the MCP handshake may take, in ms. Long, because a first `uvx` or `npx` run downloads the package. */
  connectTimeoutMs: number;
}

/** The values `settings.json` falls back to, frozen. */
export const SETTINGS_DEFAULTS: Readonly<RouterSettings> = Object.freeze({
  port: 3000,
  idleTimeoutMs: 300_000,
  sessionIdleTimeoutMs: 1_800_000,
  maxSessions: 1_000,
  connectTimeoutMs: 60_000,
});

/** How long the names in config files may be. */
export interface NameSettings {
  /** Longest server name, registry name or workspace slug, in characters. Each is a route segment and a file name. */
  serverNameMaxLength: number;
  /** Longest workspace display name, in characters. */
  workspaceNameMaxLength: number;
}

/** The length limits on names in config files, frozen. */
export const NAME_DEFAULTS: Readonly<NameSettings> = Object.freeze({
  serverNameMaxLength: 64,
  workspaceNameMaxLength: 100,
});
