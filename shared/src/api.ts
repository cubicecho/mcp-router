import { z } from 'zod';
import { serverConfigSchema, serverNameSchema, serverSourceSchema, serverTransportSchema } from './config.ts';

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

// --- POST /api/registries ---

export const createRegistryRequestSchema = z.object({
  name: serverNameSchema,
  url: z.string().url(),
});
export type CreateRegistryRequest = z.infer<typeof createRegistryRequestSchema>;

// --- GET /api/status ---

export interface RouterStatus {
  version: string;
  uptimeSeconds: number;
  serverCount: number;
  runningCount: number;
  authEnabled: boolean;
}

/** Standard error envelope for non-2xx responses. */
export interface ApiError {
  error: string;
  detail?: string;
}
