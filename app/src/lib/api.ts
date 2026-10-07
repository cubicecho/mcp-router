import {
  type ActivityResponse,
  activityResponseSchema,
  apiErrorSchema,
  type CreateRegistryRequest,
  type CreateWorkspaceRequest,
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

/** Non-2xx responses throw this; carries the HTTP status and the server's { error, detail? } envelope. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Send a request and hand back the response once it is known to have succeeded. */
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
    throw new ApiRequestError(response.status, envelope.data?.error || statusMessage, envelope.data?.detail);
  }
  return response;
}

/**
 * Send a request and read its JSON answer through the shared schema for that route, so a
 * server and an app that disagree about a shape fail here and not somewhere in a component.
 */
async function request<Schema extends z.ZodTypeAny>(
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

/** Send a request whose answer has no body. */
async function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}

export function getStatus(): Promise<RouterStatus> {
  return request('/api/status', routerStatusSchema);
}

export function listServers(): Promise<ServerStatus[]> {
  return request('/api/servers', z.array(serverStatusSchema));
}

export function getServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`, serverStatusSchema);
}

export function installServer(body: InstallRequest): Promise<ServerStatus> {
  return request('/api/servers', serverStatusSchema, { method: 'POST', body });
}

export function updateServer(name: string, body: UpdateServerRequest): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`, serverStatusSchema, { method: 'PATCH', body });
}

export function deleteServer(name: string): Promise<void> {
  return requestNoContent(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function restartServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}/restart`, serverStatusSchema, { method: 'POST' });
}

/**
 * A capability surface (tools/resources/prompts/activity + test calls) is served
 * for either a single server (`/api/servers/:name/…`) or a workspace aggregate
 * (`/api/workspaces/:slug/…`). The two share request/response shapes, so one set of
 * functions/hooks/components serves both — pick the base path from the scope.
 */
export const SCOPE_SERVER = 'server' as const;
export const SCOPE_WORKSPACE = 'workspace' as const;

export type CapabilityScope =
  | { kind: typeof SCOPE_SERVER; name: string }
  | { kind: typeof SCOPE_WORKSPACE; slug: string };

function scopeBase(scope: CapabilityScope): string {
  return scope.kind === SCOPE_SERVER
    ? `/api/servers/${encodeURIComponent(scope.name)}`
    : `/api/workspaces/${encodeURIComponent(scope.slug)}`;
}

export function getTools(scope: CapabilityScope): Promise<ServerToolsResponse> {
  return request(`${scopeBase(scope)}/tools`, serverToolsResponseSchema);
}

export function getResources(scope: CapabilityScope): Promise<ServerResourcesResponse> {
  return request(`${scopeBase(scope)}/resources`, serverResourcesResponseSchema);
}

export function readResource(scope: CapabilityScope, body: ResourceReadRequest): Promise<ResourceReadResponse> {
  return request(`${scopeBase(scope)}/resources/read`, resourceReadResponseSchema, { method: 'POST', body });
}

export function getPrompts(scope: CapabilityScope): Promise<ServerPromptsResponse> {
  return request(`${scopeBase(scope)}/prompts`, serverPromptsResponseSchema);
}

export function getPrompt(scope: CapabilityScope, body: PromptGetRequest): Promise<PromptGetResponse> {
  return request(`${scopeBase(scope)}/prompts/get`, promptGetResponseSchema, { method: 'POST', body });
}

export function callTool(scope: CapabilityScope, body: ToolCallRequest): Promise<ToolCallResponse> {
  return request(`${scopeBase(scope)}/tools/call`, toolCallResponseSchema, { method: 'POST', body });
}

export function getActivity(scope: CapabilityScope): Promise<ActivityResponse> {
  return request(`${scopeBase(scope)}/activity`, activityResponseSchema);
}

export function clearActivity(scope: CapabilityScope): Promise<void> {
  return requestNoContent(`${scopeBase(scope)}/activity`, { method: 'DELETE' });
}

export function listRegistries(): Promise<Registry[]> {
  return request('/api/registries', z.array(registrySchema));
}

export function createRegistry(body: CreateRegistryRequest): Promise<Registry> {
  return request('/api/registries', registrySchema, { method: 'POST', body });
}

export function deleteRegistry(name: string): Promise<void> {
  return requestNoContent(`/api/registries/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

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

export function listWorkspaces(): Promise<WorkspaceStatus[]> {
  return request('/api/workspaces', z.array(workspaceStatusSchema));
}

export function getWorkspace(slug: string): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, workspaceStatusSchema);
}

export function createWorkspace(body: CreateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request('/api/workspaces', workspaceStatusSchema, { method: 'POST', body });
}

export function updateWorkspace(slug: string, body: UpdateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, workspaceStatusSchema, { method: 'PATCH', body });
}

export function deleteWorkspace(slug: string): Promise<void> {
  return requestNoContent(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export function updateSettings(body: UpdateSettingsRequest): Promise<UpdateSettingsResponse> {
  return request('/api/settings', updateSettingsResponseSchema, { method: 'PATCH', body });
}

export function reloadConfig(): Promise<ReloadResponse> {
  return request('/api/reload', reloadResponseSchema, { method: 'POST' });
}
