import { z } from 'zod';
import {
  discoveredFromSchema,
  serverConfigSchema,
  serverNameSchema,
  serverSourceSchema,
  serverTransportSchema,
} from './config.ts';
import { ErrorCode } from './wire.ts';

/**
 * The management API's contract beside the GraphQL schema: the rules /graphql and /admin/mcp check their inputs
 * against, what the gateway reports about a server, and the JSON error envelope the HTTP doors (/mcp, the auth guard)
 * answer with.
 */

/** What a server's downstream connection is doing. */
export const ServerRuntimeState = {
  Stopped: 'stopped',
  Starting: 'starting',
  Running: 'running',
  Error: 'error',
  /** A remote server that asks for an OAuth login nobody has done yet, or whose login lapsed. */
  NeedsAuth: 'needs-auth',
} as const;
/** One of the {@link ServerRuntimeState} values. */
export type ServerRuntimeState = (typeof ServerRuntimeState)[keyof typeof ServerRuntimeState];

/** Where a remote server's OAuth sign-in stands. Never carries a token. */
const serverOAuthStatusSchema = z.object({
  /** Whether the router holds tokens for it. */
  signedIn: z.boolean(),
  /** When the access token runs out, ISO; absent when the server did not say. A refresh token renews it. */
  expiresAt: z.string().optional(),
  /** Whether it can be renewed without a login. */
  refreshable: z.boolean(),
  /** The pre-registered client id, when one was typed in. */
  clientId: z.string().optional(),
  /** Whether a secret is stored for `clientId`; the secret itself is never sent. */
  hasClientSecret: z.boolean(),
});
/** Where a remote server's OAuth sign-in stands. */
export type ServerOAuthStatus = z.infer<typeof serverOAuthStatusSchema>;

/** A server as the gateway reports it: its stored config plus its runtime state. */
const serverStatusSchema = z.object({
  /** The stored config, without `oauth`: tokens never leave the router. See `oauth` below. */
  config: serverConfigSchema,
  /** A remote server's sign-in; absent for a stdio server. */
  oauth: serverOAuthStatusSchema.optional(),
  state: z.enum(ServerRuntimeState),
  pid: z.number().optional(),
  startedAt: z.string().optional(), // ISO timestamp
  lastError: z.string().optional(),
  /** Populated once the downstream server has been connected at least once. */
  toolCount: z.number().optional(),
  /** Number of proxied downstream calls recorded this process (tool calls, resource/prompt reads, failures). */
  callCount: z.number().optional(),
  /** ISO timestamp of the most recent proxied call, if any. */
  lastCalledAt: z.string().optional(),
});
/** A server's stored config plus its runtime state. */
export type ServerStatus = z.infer<typeof serverStatusSchema>;

/** A pre-registered OAuth client for a remote server; `null` in an update removes it. */
const oauthClientRequestSchema = z.object({
  clientId: z.string().min(1),
  /** Omitted in an update keeps the stored secret; an empty string removes it. */
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
});
/** A pre-registered OAuth client. */
export type OAuthClientRequest = z.infer<typeof oauthClientRequestSchema>;

/** What `startServerOAuth` takes. */
export const oauthStartRequestSchema = z.object({
  /** The UI's own origin. The sign-in window reports back to it, and it is the router's address
   *  when the settings have no `publicUrl`. */
  origin: z.url(),
});

/** The message the sign-in window posts to the window that opened it, then closes. */
export const oauthResultMessageSchema = z.object({
  type: z.literal('mcp-router-oauth'),
  server: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
/** The message the sign-in window posts back. */
export type OAuthResultMessage = z.infer<typeof oauthResultMessageSchema>;

/** What `installServer` takes. */
export const installRequestSchema = z.object({
  /** Local name; also the endpoint's path segment. Derived from the package/server name when omitted. */
  name: serverNameSchema.optional(),
  source: serverSourceSchema,
  /** For source.type === 'registry': which package/remote of the registry entry to use.
   *  Index into packages[] (or 'remote:<index>'). Defaults to the first npm package, else first remote. */
  packageSelector: z.string().optional(),
  /** For source.type === 'remote': the URL to proxy to. */
  transport: serverTransportSchema.optional(),
  env: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  /** For a remote server whose login only accepts a client registered with it in advance. */
  oauthClient: oauthClientRequestSchema.optional(),
  /** For a server added from one found on the local network: which one, so it is not offered again. */
  discovered: discoveredFromSchema.optional(),
});
/** What `installServer` takes, fallbacks filled in. */
export type InstallRequest = z.infer<typeof installRequestSchema>;

/** What `updateServer` takes; an absent key is left unchanged. */
export const updateServerRequestSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  idleTimeoutMs: z.number().int().positive().nullable().optional(),
  transport: serverTransportSchema.optional(),
  /** Sets, or with `null` removes, the pre-registered OAuth client. Changing it signs the server out. */
  oauthClient: oauthClientRequestSchema.nullable().optional(),
});
/** What `updateServer` takes. */
export type UpdateServerRequest = z.infer<typeof updateServerRequestSchema>;

/** Which door a recorded call came in by. */
export const CallVia = {
  /** A server's own endpoint, /mcp/<name>. */
  Direct: 'direct',
  /** A merged endpoint: /mcp or a workspace's. */
  Aggregate: 'aggregate',
  /** The web UI's try-it calls (`callServerTool` and its siblings). */
  Ui: 'ui',
} as const;
/** One of the {@link CallVia} values. */
export type CallVia = (typeof CallVia)[keyof typeof CallVia];

/** A single proxied MCP call (request + response/error) recorded in memory for debugging. */
const activityEntrySchema = z.object({
  /** Monotonic per-process id; newest entries have the largest id. */
  id: z.number(),
  /** ISO timestamp of when the call completed. */
  at: z.string(),
  /** Which endpoint the call arrived on ('ui' = run from the web UI's try-it calls). */
  via: z.enum(CallVia),
  /** JSON-RPC method, e.g. 'tools/call', 'tools/list', 'resources/read'. */
  method: z.string(),
  /** Human-friendly target of the call (tool name, resource uri, prompt name) when applicable. */
  target: z.string().optional(),
  /** Whether the downstream call succeeded. */
  ok: z.boolean(),
  /** Wall-clock duration of the downstream call in milliseconds. */
  durationMs: z.number(),
  /** Request params sent downstream (possibly truncated). */
  params: z.unknown().optional(),
  /** Response payload when `ok` (possibly truncated). */
  result: z.unknown().optional(),
  /** Error message when not `ok`. */
  error: z.string().optional(),
});
/** One recorded proxied MCP call. */
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

/** One tool call the UI makes: `callServerTool` and `callWorkspaceTool`. */
export const toolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
/** One tool call the UI makes. */
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

/** One resource read the UI makes. The URI is a static resource's, or a concrete one expanded from a template. */
export const resourceReadRequestSchema = z.object({
  uri: z.string().min(1),
});
/** One resource read the UI makes. */
export type ResourceReadRequest = z.infer<typeof resourceReadRequestSchema>;

/** One prompt get the UI makes. MCP prompt argument values are strings. */
export const promptGetRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()).default({}),
});
/** One prompt get the UI makes. */
export type PromptGetRequest = z.infer<typeof promptGetRequestSchema>;

/** What `GET /healthz` answers. No auth, so it says nothing but that the process is serving. */
export interface Health {
  ok: boolean;
  /** The released version. */
  version: string;
}

/** The router's own status: version, uptime and server counts. */
const routerStatusSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number(),
  serverCount: z.number(),
  runningCount: z.number(),
  /** Default idle shutdown for stdio child processes, ms (per-server override wins). */
  idleTimeoutMs: z.number(),
  /** The stored `publicUrl`, when set. */
  publicUrl: z.string().optional(),
  /** This router's network name, from the stored `instanceId`. */
  instanceId: z.string(),
  /** Whether the router announces itself on the local network. */
  lanAdvertise: z.boolean(),
  /** Whether the router watches the local network for servers to offer. */
  lanDiscovery: z.boolean(),
});
/** The router's own status. */
export type RouterStatus = z.infer<typeof routerStatusSchema>;

/** What has become of a server found on the local network. */
export const DiscoveredServerState = {
  /** Not added yet: the UI offers it. */
  Available: 'available',
  /** A server config was added from it, or already points at its URL. */
  Added: 'added',
  /** The user chose not to add it; it is not offered again until restored. */
  Dismissed: 'dismissed',
} as const;
/** One of the {@link DiscoveredServerState} values. */
export type DiscoveredServerState = (typeof DiscoveredServerState)[keyof typeof DiscoveredServerState];

/** A server another host on the local network advertises. */
const discoveredServerSchema = z.object({
  /** Unique on the network: `<mDNS instance>/<card name>`. */
  key: z.string(),
  /** The Server Card's `name`, e.g. `io.github.cubicecho.mcp-skills.nas/skills`. */
  cardName: z.string(),
  /** The card's display name, when it has one. */
  title: z.string().optional(),
  description: z.string(),
  version: z.string(),
  /** The announcing host's mDNS instance name, e.g. `MCP Skills on nas`. */
  host: z.string(),
  /** The streamable-HTTP endpoint to add. */
  url: z.string(),
  /** Headers the user has to supply before it can be added, e.g. `Authorization`. */
  requiredHeaders: z.array(z.string()),
  /** A local name for it, derived from the card and free in this router. */
  suggestedName: z.string(),
  state: z.enum(DiscoveredServerState),
  /** The local server it was added as, when `state` is `added`. */
  serverName: z.string().optional(),
});
/** A server another host on the local network advertises. */
export type DiscoveredServer = z.infer<typeof discoveredServerSchema>;

/** What `lanServers` answers. */
const discoveryResponseSchema = z.object({
  /** Whether the router is watching the network (the stored `lanDiscovery`). */
  enabled: z.boolean(),
  servers: z.array(discoveredServerSchema),
});
/** What `lanServers` answers. */
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;

/** What `setLanServerDismissed` takes: hide a found server, or offer it again. */
export const setDismissedRequestSchema = z.object({
  key: z.string().min(1),
  dismissed: z.boolean(),
});

/** A registry search, as `registryServers` passes it through to the registry. */
export interface RegistrySearchParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

/** The JSON error envelope of a refused HTTP request: /mcp*, the auth and origin guards, a malformed body. */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.enum(ErrorCode),
  detail: z.string().optional(),
});
/** The JSON error envelope of a refused HTTP request. */
export type ApiError = z.infer<typeof apiErrorSchema>;

/** The longest name an API key may have. The server's api-key plugin is held to the same. */
export const API_KEY_NAME_MAX_LENGTH = 64;
/** The longest lifetime an API key may be given, in days. A key may also never expire. */
export const API_KEY_MAX_EXPIRES_IN_DAYS = 365;

/** What `createApiKey` takes. */
export const createApiKeyRequestSchema = z.object({
  /** What the operator calls it: the agent or client that will hold it. */
  name: z.string().trim().min(1, 'Name the key.').max(API_KEY_NAME_MAX_LENGTH),
  /** Days until it stops working; null or absent for never. */
  expiresInDays: z.number().int().min(1).max(API_KEY_MAX_EXPIRES_IN_DAYS).nullable().default(null),
});
/** One API key the operator asks for. */
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;
