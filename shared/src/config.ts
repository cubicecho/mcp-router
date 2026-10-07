import { z } from 'zod';
import { NAME_DEFAULTS, SETTINGS_DEFAULTS } from './defaults.ts';

/**
 * Schemas for the flat config files stored under DATA_DIR/config.
 * These files are hand-editable; parsing is always lenient on unknown keys
 * so user additions survive round-trips.
 */

/** A server name doubles as its route segment (/mcp/<name>) and its install dir. */
export const serverNameSchema = z
  .string()
  .min(1)
  .max(NAME_DEFAULTS.serverNameMaxLength)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric');

/** One registry the router can browse and install from. */
export const registrySchema = z
  .object({
    /** Unique short name, e.g. "official" */
    name: serverNameSchema,
    /** Base URL of an MCP-registry-API-compatible service, e.g. https://registry.modelcontextprotocol.io */
    url: z.url(),
  })
  .loose();

/** Shape of `registries.json`. */
export const registriesFileSchema = z
  .object({
    registries: z.array(registrySchema).default([]),
  })
  .loose();

/** A configured registry. */
export type Registry = z.infer<typeof registrySchema>;
/** Parsed `registries.json`. */
export type RegistriesFile = z.infer<typeof registriesFileSchema>;

/** The registry seeded on first run. */
export const DEFAULT_REGISTRY: Registry = {
  name: 'official',
  url: 'https://registry.modelcontextprotocol.io',
};

/** Shape of `settings.json`; every key has a fallback, so an empty object parses. */
export const settingsFileSchema = z
  .object({
    /** HTTP port. Env PORT wins over this. */
    port: z.number().int().positive().default(SETTINGS_DEFAULTS.port),
    /** Bearer token for the management API and MCP endpoints. Env MCP_ROUTER_TOKEN wins.
     *  Generated on first run when auth is enabled and no token exists. */
    authToken: z.string().nullable().default(null),
    /** Disable to allow unauthenticated access (trusted networks only). */
    authEnabled: z.boolean().default(true),
    /** Network interface to bind. Env HOST wins. Unset binds all interfaces (needed for Docker/LAN
     *  exposure); set to 127.0.0.1 to restrict to localhost. */
    host: z.string().optional(),
    /** Extra browser Origins allowed to reach /mcp, for DNS-rebinding protection. Loopback origins
     *  are always allowed and native MCP clients send no Origin; add browser-based clients here. */
    allowedOrigins: z.array(z.string()).default([]),
    /** Default idle shutdown for stdio child processes (per-server override wins). */
    idleTimeoutMs: z.number().int().positive().default(SETTINGS_DEFAULTS.idleTimeoutMs),
    /** Idle lifetime of an MCP streamable-HTTP session before the router reclaims it.
     *  Sessions normally end on a client DELETE; this bounds ones abandoned without one
     *  (a client that drops its stream and never returns), counted from its last request or
     *  from when its GET SSE stream closed; a session holding that stream open is never
     *  reclaimed. Reclaimed sessions 404 on the next request — which the MCP SDK's client does
     *  not recover from on its own, hence the exemption. */
    sessionIdleTimeoutMs: z.number().int().positive().default(SETTINGS_DEFAULTS.sessionIdleTimeoutMs),
    /** Hard cap on concurrent live MCP sessions; the least-recently-active are evicted past it. */
    maxSessions: z.number().int().positive().default(SETTINGS_DEFAULTS.maxSessions),
    /** How long a downstream connect — spawn plus the MCP initialize handshake — may take before
     *  the router gives up and reports the server as failed. Bounds a child that starts and then
     *  never speaks; the MCP SDK's own 60s applies to the initialize *request*, which such a child
     *  never gets far enough to answer. Generous by default because a first `uvx`/`npx` spawn may
     *  resolve and download the package before it says anything. Like `idleTimeoutMs` it is
     *  re-read on every reconcile, and applies at the next connect — an edited timeout is no
     *  reason to bounce a running child. */
    connectTimeoutMs: z.number().int().positive().default(SETTINGS_DEFAULTS.connectTimeoutMs),
  })
  .loose();

/** Parsed `settings.json`, fallbacks filled in. */
export type SettingsFile = z.infer<typeof settingsFileSchema>;

/** Where a server came from. */
export const SourceType = {
  /** Installed from a configured registry. */
  Registry: 'registry',
  /** Installed directly from npm. */
  Npm: 'npm',
  /** A PyPI package run with `uvx`. */
  Pypi: 'pypi',
  /** A server added by hand: nothing was installed. */
  Remote: 'remote',
} as const;
/** One of the {@link SourceType} values. */
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

/** A child process the router spawns and talks to over stdin and stdout. */
export const TRANSPORT_STDIO = 'stdio' as const;
/** A server reached over streamable HTTP. */
export const TRANSPORT_STREAMABLE_HTTP = 'streamable-http' as const;

/** Where a server came from, discriminated on `type`. */
export const serverSourceSchema = z.discriminatedUnion('type', [
  /** Installed from a configured registry. */
  z.object({
    type: z.literal(SourceType.Registry),
    /** Name of the registry in registries.json */
    registry: z.string(),
    /** Registry server name, e.g. "io.github.owner/repo" */
    serverName: z.string(),
    version: z.string().optional(),
  }),
  /** Installed directly from npm, no registry involved. */
  z.object({
    type: z.literal(SourceType.Npm),
    package: z.string(),
    version: z.string().optional(),
  }),
  /** A PyPI package run via `uvx`, no registry involved. */
  z.object({
    type: z.literal(SourceType.Pypi),
    package: z.string(),
    version: z.string().optional(),
  }),
  /** A remote streamable-http/sse server we merely proxy to. Nothing installed. */
  z.object({
    type: z.literal(SourceType.Remote),
  }),
]);

/** How the router reaches a server, discriminated on `type`: a spawned command or a URL. */
export const serverTransportSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(TRANSPORT_STDIO),
    /** Executable, e.g. "node" or an absolute bin path. */
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
  }),
  z.object({
    type: z.literal(TRANSPORT_STREAMABLE_HTTP),
    url: z.url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);

/** UI metadata for one env var, sourced from the registry's environmentVariables. */
export const envVarMetaSchema = z
  .object({
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    default: z.string().optional(),
    placeholder: z.string().optional(),
    choices: z.array(z.string()).optional(),
  })
  .loose();

/** Shape of `servers/<name>.json`: one installed server. */
export const serverConfigSchema = z
  .object({
    name: serverNameSchema,
    displayName: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().default(true),
    source: serverSourceSchema,
    transport: serverTransportSchema,
    /** Env vars passed to the child process (stdio) or sent as headers is NOT done here —
     *  headers for remote servers live on the transport. Values are plaintext. */
    env: z.record(z.string(), z.string()).default({}),
    /** Describes known env vars for UI rendering; keys are env var names. */
    envMeta: z.record(z.string(), envVarMetaSchema).default({}),
    /** Override the global stdio idle shutdown. */
    idleTimeoutMs: z.number().int().positive().optional(),
  })
  .loose();

/** Where a server came from. */
export type ServerSource = z.infer<typeof serverSourceSchema>;
/** How the router reaches a server. */
export type ServerTransport = z.infer<typeof serverTransportSchema>;
/** UI metadata for one env var. */
export type EnvVarMeta = z.infer<typeof envVarMetaSchema>;
/** One installed server's stored config. */
export type ServerConfig = z.infer<typeof serverConfigSchema>;

/**
 * A server's participation in a workspace, with optional per-workspace parameter
 * overrides. When any override is set the server runs as its own downstream
 * process for that workspace (keyed separately from the shared base instance);
 * with no overrides it still runs isolated under the workspace. Merge semantics:
 * `env` and `headers` are merged over the base server's values (workspace keys
 * win); `args` and `url` replace the base value entirely when present.
 */
export const workspaceMemberSchema = z
  .object({
    /** Include this server in the workspace aggregate. Absent members are not in the workspace. */
    enabled: z.boolean().default(true),
    /** Env vars merged over the base server's env (stdio children). */
    env: z.record(z.string(), z.string()).optional(),
    /** Replaces the base server's stdio args entirely when set. */
    args: z.array(z.string()).optional(),
    /** Headers merged over the base server's headers (remote streamable-http). */
    headers: z.record(z.string(), z.string()).optional(),
    /** Replaces the base server's streamable-http URL entirely when set (remote members) —
     *  e.g. to scope a shared upstream to a workspace-specific path. */
    url: z.url().optional(),
  })
  .loose();

/** A named custom aggregate exposing a chosen subset of servers at /mcp/w/<slug>. */
export const workspaceConfigSchema = z
  .object({
    /** Human-facing display name. */
    name: z.string().min(1).max(NAME_DEFAULTS.workspaceNameMaxLength),
    /** URL slug — the route segment at /mcp/w/<slug>, also the config filename. */
    slug: serverNameSchema,
    /** Disable to 404 the workspace's endpoint without deleting it. */
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    /** Members keyed by base server name. Only listed servers are in the workspace. */
    members: z.record(z.string(), workspaceMemberSchema).default({}),
  })
  .loose();

/** A server's participation in a workspace, with its overrides. */
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
/** One workspace's stored config. */
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;

/**
 * Cuts text down to the characters a server name may hold.
 *
 * @param text - Any text.
 * @returns Lower-cased text with each run of other characters turned into one dash and leading non-alphanumerics
 * dropped; may be empty, and is not length-limited.
 */
function toNameChars(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '');
}

/**
 * Derives a URL slug from a display name.
 *
 * @param name - The display name.
 * @returns A value `serverNameSchema` accepts, or an empty string when the name has no usable characters.
 */
export function slugify(name: string): string {
  return toNameChars(name)
    .replace(/[-.]+$/, '') // no trailing dash/dot
    .slice(0, NAME_DEFAULTS.serverNameMaxLength);
}

/**
 * Suggests a local server name from a package or registry name.
 *
 * @param raw - A name like "io.github.owner/repo"; only the part after the last slash is used.
 * @returns The suggestion, cut to the longest allowed name. Empty when nothing usable is left, so validate it before
 * saving.
 */
export function suggestServerName(raw: string): string {
  const lastSegment = raw.split('/').pop() ?? raw;
  return toNameChars(lastSegment).slice(0, NAME_DEFAULTS.serverNameMaxLength);
}
