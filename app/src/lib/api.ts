import {
  type ActivityResponse,
  type ApiError,
  type CreateRegistryRequest,
  type CreateWorkspaceRequest,
  HttpStatus,
  type InstallRequest,
  type PromptGetRequest,
  type PromptGetResponse,
  type Registry,
  type RegistryListResponse,
  type ResourceReadRequest,
  type ResourceReadResponse,
  type RouterStatus,
  type ServerPromptsResponse,
  type ServerResourcesResponse,
  type ServerStatus,
  type ServerToolsResponse,
  type ToolCallRequest,
  type ToolCallResponse,
  type UpdateServerRequest,
  type UpdateSettingsRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceStatus,
} from '@mcp-router/shared';
import { getToken, requireAuth } from './auth';

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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    let message = response.statusText || `Request failed (${response.status})`;
    let detail: string | undefined;
    try {
      const payload = (await response.json()) as Partial<ApiError>;
      if (typeof payload.error === 'string' && payload.error.length > 0) {
        message = payload.error;
      }
      if (typeof payload.detail === 'string') {
        detail = payload.detail;
      }
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiRequestError(response.status, message, detail);
  }

  const text = await response.text();
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

// --- status ---

export function getStatus(): Promise<RouterStatus> {
  return request('/api/status');
}

// --- servers ---

export function listServers(): Promise<ServerStatus[]> {
  return request('/api/servers');
}

export function getServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`);
}

export function installServer(body: InstallRequest): Promise<ServerStatus> {
  return request('/api/servers', { method: 'POST', body });
}

export function updateServer(name: string, body: UpdateServerRequest): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}`, { method: 'PATCH', body });
}

export function deleteServer(name: string): Promise<void> {
  return request(`/api/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function restartServer(name: string): Promise<ServerStatus> {
  return request(`/api/servers/${encodeURIComponent(name)}/restart`, { method: 'POST' });
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
  return request(`${scopeBase(scope)}/tools`);
}

export function getResources(scope: CapabilityScope): Promise<ServerResourcesResponse> {
  return request(`${scopeBase(scope)}/resources`);
}

export function readResource(scope: CapabilityScope, body: ResourceReadRequest): Promise<ResourceReadResponse> {
  return request(`${scopeBase(scope)}/resources/read`, { method: 'POST', body });
}

export function getPrompts(scope: CapabilityScope): Promise<ServerPromptsResponse> {
  return request(`${scopeBase(scope)}/prompts`);
}

export function getPrompt(scope: CapabilityScope, body: PromptGetRequest): Promise<PromptGetResponse> {
  return request(`${scopeBase(scope)}/prompts/get`, { method: 'POST', body });
}

export function callTool(scope: CapabilityScope, body: ToolCallRequest): Promise<ToolCallResponse> {
  return request(`${scopeBase(scope)}/tools/call`, { method: 'POST', body });
}

export function getActivity(scope: CapabilityScope): Promise<ActivityResponse> {
  return request(`${scopeBase(scope)}/activity`);
}

export function clearActivity(scope: CapabilityScope): Promise<void> {
  return request(`${scopeBase(scope)}/activity`, { method: 'DELETE' });
}

// --- registries ---

export async function listRegistries(): Promise<Registry[]> {
  // Tolerate both a bare array and the registries.json file shape.
  const data = await request<Registry[] | { registries: Registry[] }>('/api/registries');
  return Array.isArray(data) ? data : data.registries;
}

export function createRegistry(body: CreateRegistryRequest): Promise<Registry> {
  return request('/api/registries', { method: 'POST', body });
}

export function deleteRegistry(name: string): Promise<void> {
  return request(`/api/registries/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export interface RegistrySearchParams {
  search?: string;
  cursor?: string;
  limit?: number;
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
  return request(`/api/registries/${encodeURIComponent(registry)}/servers${suffix}`);
}

// --- workspaces ---

export function listWorkspaces(): Promise<WorkspaceStatus[]> {
  return request('/api/workspaces');
}

export function getWorkspace(slug: string): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`);
}

export function createWorkspace(body: CreateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request('/api/workspaces', { method: 'POST', body });
}

export function updateWorkspace(slug: string, body: UpdateWorkspaceRequest): Promise<WorkspaceStatus> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
}

export function deleteWorkspace(slug: string): Promise<void> {
  return request(`/api/workspaces/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

// --- config ---

export function updateSettings(body: UpdateSettingsRequest): Promise<{ idleTimeoutMs: number }> {
  return request('/api/settings', { method: 'PATCH', body });
}

export function reloadConfig(): Promise<unknown> {
  return request('/api/reload', { method: 'POST' });
}
