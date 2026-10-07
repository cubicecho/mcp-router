import {
  type ActivityResponse,
  activityResponseSchema,
  apiErrorSchema,
  type CreateRegistryRequest,
  type CreateWorkspaceRequest,
  type ErrorCode,
  HttpStatus,
  type InstallRequest,
  type PromptGetRequest,
  type PromptGetResponse,
  promptGetResponseSchema,
  type Registry,
  type RegistryListResponse,
  type RegistrySearchParams,
  type ReloadResponse,
  type ResourceReadRequest,
  type ResourceReadResponse,
  type RouterStatus,
  registryListResponseSchema,
  registrySchema,
  reloadResponseSchema,
  resourceReadResponseSchema,
  routerStatusSchema,
  type ServerPromptsResponse,
  type ServerResourcesResponse,
  type ServerStatus,
  type ServerToolsResponse,
  serverPromptsResponseSchema,
  serverResourcesResponseSchema,
  serverStatusSchema,
  serverToolsResponseSchema,
  type ToolCallRequest,
  type ToolCallResponse,
  toolCallResponseSchema,
  type UpdateServerRequest,
  type UpdateSettingsRequest,
  type UpdateSettingsResponse,
  type UpdateWorkspaceRequest,
  updateSettingsResponseSchema,
  type WorkspaceStatus,
  workspaceStatusSchema,
} from '@mcp-router/shared';
import { z } from 'zod';
import { getToken, requireAuth } from './auth.ts';

/** A non-2xx answer from the API, carrying the HTTP status and the server's `{ error, code, detail? }` envelope. */
export class ApiRequestError extends Error {
  /** HTTP status of the answer. */
  readonly status: number;
  /** Undefined when the answer was not an envelope (a proxy's own error page). */
  readonly code?: ErrorCode;
  /** The envelope's longer explanation, when the server sent one. */
  readonly detail?: string;

  /**
   * Builds the error from a failed answer.
   *
   * @param status - HTTP status of the answer.
   * @param message - The envelope's `error`, or the status text when there was no envelope.
   * @param [envelope] - The envelope's `code` and `detail`; omit when the answer was not an envelope.
   */
  constructor(status: number, message: string, envelope: { code?: ErrorCode; detail?: string } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = envelope.code;
    this.detail = envelope.detail;
  }
}

/** What a request sends besides its path. */
interface RequestOptions {
  /**
   * HTTP method.
   *
   * @defaultValue `'GET'`
   */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Sent as JSON; `undefined` sends no body and no Content-Type. */
  body?: unknown;
}

/**
 * Sends a request and hands back the response once it is known to have succeeded.
 *
 * @param path - Same-origin path, query included.
 * @param [options] - Method and JSON body.
 * @returns The 2xx response, body unread. Throws `ApiRequestError` on any other status.
 *
 * @remarks
 * Adds the stored bearer token when there is one. A 401 raises the needs-auth flag before it throws.
 */
async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === HttpStatus.Unauthorized) {
    requireAuth();
  }

  const requestFailed = response.ok === false;
  if (requestFailed) {
    const envelope = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    const statusMessage = response.statusText || `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, envelope.data?.error || statusMessage, {
      code: envelope.data?.code,
      detail: envelope.data?.detail,
    });
  }
  return response;
}

/**
 * Sends a request and reads its JSON answer through the shared schema for that route.
 *
 * @typeParam Schema - The zod schema the answer must match.
 * @param path - Same-origin path, query included.
 * @param schema - Parses the answer.
 * @param [options] - Method and JSON body.
 * @returns The parsed answer. Throws `ApiRequestError` on a non-2xx status, an `Error` when the answer does not match.
 *
 * @remarks
 * A server and an app that disagree about a shape fail here and not somewhere in a component.
 */
async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: RequestOptions = {},
): Promise<z.infer<Schema>> {
  const response = await send(path, options);
  const result = schema.safeParse(await response.json());
  if (result.success === false) {
    throw new Error(`Unexpected response from ${options.method ?? 'GET'} ${path}`, { cause: result.error });
  }
  return result.data;
}

/**
 * Sends a request whose answer has no body.
 *
 * @param path - Same-origin path, query included.
 * @param [options] - Method and JSON body.
 *
 * @remarks
 * Throws `ApiRequestError` on a non-2xx status.
 */
async function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}

/**
 * Reads the router's own status from `GET /api/status`.
 *
 * @returns Version, uptime, server counts, and whether auth is on.
 */
export function getStatus(): Promise<RouterStatus> {
  return request('/api/status', routerStatusSchema);
}

/**
 * Lists every installed server from `GET /api/servers`.
 *
 * @returns Each server's config and live status.
 */
export function listServers(): Promise<ServerStatus[]> {
  return request('/api/servers', z.array(serverStatusSchema));
}

/**
 * Reads one server from `GET /api/servers/:name`.
 *
 * @param name - The server's local name.
 * @returns Its config and live status.
 */
export function getServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`, serverStatusSchema);
}

/**
 * Installs a server with `POST /api/servers`.
 *
 * @param body - What to install and how to configure it.
 * @returns The new server's status.
 */
export function installServer(body: InstallRequest): Promise<ServerStatus> {
  return request('/api/servers', serverStatusSchema, { method: 'POST', body });
}

/**
 * Changes a server's config with `PATCH /api/servers/:name`.
 *
 * @param name - The server's local name.
 * @param body - Only the fields to change.
 * @returns The server's status after the change.
 */
export function updateServer(name: string, body: UpdateServerRequest): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`, serverStatusSchema, { method: 'PATCH', body });
}

/**
 * Uninstalls a server with `DELETE /api/servers/:name`.
 *
 * @param name - The server's local name.
 */
export function deleteServer(name: string): Promise<void> {
  return requestNoContent(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/**
 * Restarts a server with `POST /api/servers/:name/restart`.
 *
 * @param name - The server's local name.
 * @returns The server's status after the restart.
 */
export function restartServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}/restart`, serverStatusSchema, { method: 'POST' });
}

/** The `kind` of a capability scope that is one server. */
export const SCOPE_SERVER = 'server' as const;
/** The `kind` of a capability scope that is a workspace aggregate. */
export const SCOPE_WORKSPACE = 'workspace' as const;

/**
 * Whose capability surface (tools, resources, prompts, activity, test calls) a call is about.
 *
 * @remarks
 * A single server (`/api/servers/:name/…`) and a workspace (`/api/workspaces/:slug/…`) share request and response
 * shapes, so one set of functions, hooks and components serves both.
 */
export type CapabilityScope =
  | { kind: typeof SCOPE_SERVER; name: string }
  | { kind: typeof SCOPE_WORKSPACE; slug: string };

/**
 * Picks the API base path of a capability scope.
 *
 * @param scope - The server or workspace.
 * @returns `/api/servers/:name` or `/api/workspaces/:slug`, the name or slug URL-encoded.
 */
function scopeBase(scope: CapabilityScope): string {
  return scope.kind === SCOPE_SERVER
    ? `/api/servers/${encodeURIComponent(scope.name)}`
    : `/api/workspaces/${encodeURIComponent(scope.slug)}`;
}

/**
 * Lists a scope's tools from `GET …/tools`.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The tools.
 */
export function getTools(scope: CapabilityScope): Promise<ServerToolsResponse> {
  return request(`${scopeBase(scope)}/tools`, serverToolsResponseSchema);
}

/**
 * Lists a scope's resources from `GET …/resources`.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The resources and resource templates.
 */
export function getResources(scope: CapabilityScope): Promise<ServerResourcesResponse> {
  return request(`${scopeBase(scope)}/resources`, serverResourcesResponseSchema);
}

/**
 * Reads one resource through `POST …/resources/read`.
 *
 * @param scope - The server or workspace that serves it.
 * @param body - Which resource to read.
 * @returns The resource's contents.
 */
export function readResource(scope: CapabilityScope, body: ResourceReadRequest): Promise<ResourceReadResponse> {
  return request(`${scopeBase(scope)}/resources/read`, resourceReadResponseSchema, { method: 'POST', body });
}

/**
 * Lists a scope's prompts from `GET …/prompts`.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The prompts.
 */
export function getPrompts(scope: CapabilityScope): Promise<ServerPromptsResponse> {
  return request(`${scopeBase(scope)}/prompts`, serverPromptsResponseSchema);
}

/**
 * Renders one prompt through `POST …/prompts/get`.
 *
 * @param scope - The server or workspace that serves it.
 * @param body - The prompt and its arguments.
 * @returns The prompt's messages.
 */
export function getPrompt(scope: CapabilityScope, body: PromptGetRequest): Promise<PromptGetResponse> {
  return request(`${scopeBase(scope)}/prompts/get`, promptGetResponseSchema, { method: 'POST', body });
}

/**
 * Calls one tool through `POST …/tools/call`.
 *
 * @param scope - The server or workspace that serves it.
 * @param body - The tool and its arguments.
 * @returns The tool's result; `isError` marks a tool that reported its own failure.
 */
export function callTool(scope: CapabilityScope, body: ToolCallRequest): Promise<ToolCallResponse> {
  return request(`${scopeBase(scope)}/tools/call`, toolCallResponseSchema, { method: 'POST', body });
}

/**
 * Reads a scope's proxied-call log from `GET …/activity`.
 *
 * @param scope - The server or workspace.
 * @returns The recorded calls.
 */
export function getActivity(scope: CapabilityScope): Promise<ActivityResponse> {
  return request(`${scopeBase(scope)}/activity`, activityResponseSchema);
}

/**
 * Empties a scope's proxied-call log with `DELETE …/activity`.
 *
 * @param scope - The server or workspace.
 */
export function clearActivity(scope: CapabilityScope): Promise<void> {
  return requestNoContent(`${scopeBase(scope)}/activity`, { method: 'DELETE' });
}

/**
 * Lists the configured registries from `GET /api/registries`.
 *
 * @returns Each registry's name and URL.
 */
export function listRegistries(): Promise<Registry[]> {
  return request('/api/registries', z.array(registrySchema));
}

/**
 * Adds a registry with `POST /api/registries`.
 *
 * @param body - The registry to add.
 * @returns The registry as saved.
 */
export function createRegistry(body: CreateRegistryRequest): Promise<Registry> {
  return request('/api/registries', registrySchema, { method: 'POST', body });
}

/**
 * Removes a registry with `DELETE /api/registries/:name`.
 *
 * @param name - The registry's name.
 */
export function deleteRegistry(name: string): Promise<void> {
  return requestNoContent(`/api/registries/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/**
 * Searches one registry's servers through `GET /api/registries/:name/servers`.
 *
 * @param registry - The registry's name.
 * @param [params] - Search text, page cursor and page size; an empty or absent one is left off the query.
 * @returns One page of entries; `metadata.nextCursor` is set while more remain.
 */
export function searchRegistryServers(
  registry: string,
  params: RegistrySearchParams = {},
): Promise<RegistryListResponse> {
  const query = new URLSearchParams();
  if (params.search) {
    query.set('search', params.search);
  }
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return request(`/api/registries/${encodeURIComponent(registry)}/servers${suffix}`, registryListResponseSchema);
}

/**
 * Lists every workspace from `GET /api/workspaces`.
 *
 * @returns Each workspace's config and endpoint path.
 */
export function listWorkspaces(): Promise<WorkspaceStatus[]> {
  return request('/api/workspaces', z.array(workspaceStatusSchema));
}

/**
 * Reads one workspace from `GET /api/workspaces/:slug`.
 *
 * @param slug - The workspace's slug.
 * @returns Its config and endpoint path.
 */
export function getWorkspace(slug: string): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, workspaceStatusSchema);
}

/**
 * Creates a workspace with `POST /api/workspaces`.
 *
 * @param body - The workspace to create.
 * @returns The workspace as saved.
 */
export function createWorkspace(body: CreateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request('/api/workspaces', workspaceStatusSchema, { method: 'POST', body });
}

/**
 * Changes a workspace with `PATCH /api/workspaces/:slug`.
 *
 * @param slug - The workspace's slug.
 * @param body - Only the fields to change.
 * @returns The workspace after the change.
 */
export function updateWorkspace(slug: string, body: UpdateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, workspaceStatusSchema, { method: 'PATCH', body });
}

/**
 * Deletes a workspace with `DELETE /api/workspaces/:slug`.
 *
 * @param slug - The workspace's slug.
 */
export function deleteWorkspace(slug: string): Promise<void> {
  return requestNoContent(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

/**
 * Changes router settings with `PATCH /api/settings`.
 *
 * @param body - Only the settings to change.
 * @returns The settings after the change.
 */
export function updateSettings(body: UpdateSettingsRequest): Promise<UpdateSettingsResponse> {
  return request('/api/settings', updateSettingsResponseSchema, { method: 'PATCH', body });
}

/**
 * Makes the router re-read its config files with `POST /api/reload`.
 *
 * @returns Whether it reloaded, and the server count afterwards.
 */
export function reloadConfig(): Promise<ReloadResponse> {
  return request('/api/reload', reloadResponseSchema, { method: 'POST' });
}
