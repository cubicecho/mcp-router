import { z } from 'zod';
import {
  serverConfigSchema,
  serverNameSchema,
  serverSourceSchema,
  serverTransportSchema,
  workspaceConfigSchema,
  workspaceMemberSchema,
} from './config.ts';

/**
 * DTOs for the management REST API (/api/*).
 * All endpoints require `Authorization: Bearer <token>` unless auth is disabled.
 */

// --- runtime status ---

export const serverRuntimeStateSchema = z.enum(['stopped', 'starting', 'running', 'error']);
export type ServerRuntimeState = z.infer<typeof serverRuntimeStateSchema>;

export const serverStatusSchema = z.object({
  config: serverConfigSchema,
  state: serverRuntimeStateSchema,
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
export type ServerStatus = z.infer<typeof serverStatusSchema>;

// --- POST /api/servers (install) ---

export const installRequestSchema = z.object({
  /** Local name; also the route segment. Derived from the package/server name when omitted. */
  name: serverNameSchema.optional(),
  source: serverSourceSchema,
  /** For source.type === 'registry': which package/remote of the registry entry to use.
   *  Index into packages[] (or 'remote:<index>'). Defaults to the first npm package, else first remote. */
  packageSelector: z.string().optional(),
  /** For source.type === 'remote': the URL to proxy to. */
  transport: serverTransportSchema.optional(),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
});
export type InstallRequest = z.infer<typeof installRequestSchema>;

// --- PATCH /api/servers/:name ---

export const updateServerRequestSchema = z.object({
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.record(z.string()).optional(),
  idleTimeoutMs: z.number().int().positive().nullable().optional(),
  transport: serverTransportSchema.optional(),
});
export type UpdateServerRequest = z.infer<typeof updateServerRequestSchema>;

// --- GET /api/servers/:name/activity ---

/** A single proxied MCP call (request + response/error) recorded in memory for debugging. */
export const activityEntrySchema = z.object({
  /** Monotonic per-process id; newest entries have the largest id. */
  id: z.number(),
  /** ISO timestamp of when the call completed. */
  at: z.string(),
  /** Which endpoint the call arrived on ('ui' = run from the web UI's tool runner). */
  via: z.enum(['direct', 'aggregate', 'ui']),
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
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const activityResponseSchema = z.object({
  entries: z.array(activityEntrySchema),
});
export type ActivityResponse = z.infer<typeof activityResponseSchema>;

// --- POST /api/servers/:name/tools/call ---

/** Run one tool of a downstream server from the UI. */
export const toolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

/** MCP CallToolResult, loosely typed — content shape is tool-defined. */
export const toolCallResponseSchema = z
  .object({
    content: z.array(z.unknown()).optional(),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();
export type ToolCallResponse = z.infer<typeof toolCallResponseSchema>;

// --- POST /api/servers/:name/resources/read ---

/** Read one resource of a downstream server from the UI. The URI is either a
 *  static resource's URI or a concrete URI expanded from a resource template. */
export const resourceReadRequestSchema = z.object({
  uri: z.string().min(1),
});
export type ResourceReadRequest = z.infer<typeof resourceReadRequestSchema>;

/** MCP ReadResourceResult, loosely typed — contents shape is resource-defined. */
export const resourceReadResponseSchema = z
  .object({
    contents: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type ResourceReadResponse = z.infer<typeof resourceReadResponseSchema>;

// --- POST /api/servers/:name/prompts/get ---

/** Get one prompt of a downstream server from the UI. MCP prompt argument
 *  values are strings. */
export const promptGetRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string()).default({}),
});
export type PromptGetRequest = z.infer<typeof promptGetRequestSchema>;

/** MCP GetPromptResult, loosely typed — messages shape is prompt-defined. */
export const promptGetResponseSchema = z
  .object({
    description: z.string().optional(),
    messages: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type PromptGetResponse = z.infer<typeof promptGetResponseSchema>;

// --- POST /api/registries ---

export const createRegistryRequestSchema = z.object({
  name: serverNameSchema,
  url: z.string().url(),
});
export type CreateRegistryRequest = z.infer<typeof createRegistryRequestSchema>;

// --- /api/workspaces ---

/** A workspace as returned by the API: its stored config plus the derived endpoint path. */
export const workspaceStatusSchema = workspaceConfigSchema.extend({
  /** Endpoint path of the workspace aggregate, e.g. "/mcp/w/my-workspace". */
  path: z.string(),
});
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100),
  /** Slug for the URL; derived from `name` when omitted. */
  slug: serverNameSchema.optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Members keyed by base server name; only listed servers are in the workspace. */
  members: z.record(workspaceMemberSchema).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Full replacement of the members map when provided. */
  members: z.record(workspaceMemberSchema).optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

// --- GET /api/status ---

export interface RouterStatus {
  version: string;
  uptimeSeconds: number;
  serverCount: number;
  runningCount: number;
  authEnabled: boolean;
  /** Default idle shutdown for stdio child processes, ms (per-server override wins). */
  idleTimeoutMs: number;
}

// --- PATCH /api/settings ---

/** The subset of settings.json editable from the UI. */
export const updateSettingsRequestSchema = z.object({
  idleTimeoutMs: z.number().int().positive().optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/** Standard error envelope for non-2xx responses. */
export interface ApiError {
  error: string;
  detail?: string;
}
