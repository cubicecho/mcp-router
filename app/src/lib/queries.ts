import type {
  CreateRegistryRequest,
  CreateWorkspaceRequest,
  InstallRequest,
  UpdateServerRequest,
  UpdateSettingsRequest,
  UpdateWorkspaceRequest,
} from '@mcp-router/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { type CapabilityScope, SCOPE_SERVER } from './api.ts';
import { POLLING_DEFAULTS } from './defaults.ts';

/**
 * Builds the root query key of a capability scope; capability keys hang off it.
 *
 * @param scope - The server or workspace.
 * @returns `['servers', name]` or `['workspaces', slug]`, the same key as that server's or workspace's detail query.
 */
function scopeKey(scope: CapabilityScope): readonly [string, string] {
  return scope.kind === SCOPE_SERVER ? ['servers', scope.name] : ['workspaces', scope.slug];
}

/** Every query key the app uses; a key that starts with another is invalidated along with it. */
export const queryKeys = {
  status: ['status'] as const,
  servers: ['servers'] as const,
  server: (name: string) => ['servers', name] as const,
  capabilityTools: (scope: CapabilityScope) => [...scopeKey(scope), 'tools'] as const,
  capabilityResources: (scope: CapabilityScope) => [...scopeKey(scope), 'resources'] as const,
  capabilityPrompts: (scope: CapabilityScope) => [...scopeKey(scope), 'prompts'] as const,
  capabilityActivity: (scope: CapabilityScope) => [...scopeKey(scope), 'activity'] as const,
  registries: ['registries'] as const,
  registrySearch: (registry: string, search: string) => ['registries', registry, 'search', search] as const,
  workspaces: ['workspaces'] as const,
  workspace: (slug: string) => ['workspaces', slug] as const,
};

/**
 * Reads the router's status and keeps it polled.
 *
 * @returns The query; `data` is the router status.
 */
export function useRouterStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: POLLING_DEFAULTS.statusMs,
  });
}

/**
 * Lists every server and keeps the list polled.
 *
 * @returns The query; `data` is each server's config and live status.
 */
export function useServers() {
  return useQuery({
    queryKey: queryKeys.servers,
    queryFn: api.listServers,
    // Poll so the live call counts / last-called times stay current.
    refetchInterval: POLLING_DEFAULTS.serverListMs,
  });
}

/**
 * Reads one server and keeps it polled.
 *
 * @param name - The server's local name.
 * @returns The query; `data` is the server's config and live status.
 */
export function useServer(name: string) {
  return useQuery({
    queryKey: queryKeys.server(name),
    queryFn: () => api.getServer(name),
    // Keep the detail page's state/pid live (crashes, idle shutdowns).
    refetchInterval: POLLING_DEFAULTS.detailMs,
  });
}

/** A capability listing may spawn the downstream server(s) — allow it to be slow, never auto-retry. */
const CAPABILITY_LISTING = { retry: false, staleTime: POLLING_DEFAULTS.capabilityStaleMs } as const;

/**
 * Lists a scope's tools.
 *
 * @param scope - The server or workspace.
 * @returns The query; `data` is the tools listing. Never retried, since a failed listing may have spawned a server.
 */
export function useCapabilityTools(scope: CapabilityScope) {
  return useQuery({
    ...CAPABILITY_LISTING,
    queryKey: queryKeys.capabilityTools(scope),
    queryFn: () => api.getTools(scope),
  });
}

/**
 * Lists a scope's resources.
 *
 * @param scope - The server or workspace.
 * @returns The query; `data` is the resources and resource templates. Never retried.
 */
export function useCapabilityResources(scope: CapabilityScope) {
  return useQuery({
    ...CAPABILITY_LISTING,
    queryKey: queryKeys.capabilityResources(scope),
    queryFn: () => api.getResources(scope),
  });
}

/**
 * Lists a scope's prompts.
 *
 * @param scope - The server or workspace.
 * @returns The query; `data` is the prompts listing. Never retried.
 */
export function useCapabilityPrompts(scope: CapabilityScope) {
  return useQuery({
    ...CAPABILITY_LISTING,
    queryKey: queryKeys.capabilityPrompts(scope),
    queryFn: () => api.getPrompts(scope),
  });
}

/**
 * Reads the proxied-call log of a server or workspace, polling while mounted.
 *
 * @param scope - The server or workspace.
 * @returns The query; `data` is the recorded calls, which the server keeps in memory only.
 */
export function useCapabilityActivity(scope: CapabilityScope) {
  return useQuery({
    queryKey: queryKeys.capabilityActivity(scope),
    queryFn: () => api.getActivity(scope),
    refetchInterval: POLLING_DEFAULTS.activityMs,
  });
}

/**
 * Reads one workspace and keeps it polled, so member and enabled changes show promptly.
 *
 * @param slug - The workspace's slug.
 * @returns The query; `data` is the workspace's config and endpoint path.
 */
export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: queryKeys.workspace(slug),
    queryFn: () => api.getWorkspace(slug),
    refetchInterval: POLLING_DEFAULTS.detailMs,
  });
}

/**
 * Lists the configured registries.
 *
 * @returns The query; `data` is each registry's name and URL.
 */
export function useRegistries() {
  return useQuery({
    queryKey: queryKeys.registries,
    queryFn: api.listRegistries,
  });
}

/**
 * Searches one registry's servers, a page at a time.
 *
 * @param registry - The registry's name; the query stays idle while it is empty.
 * @param search - Search text; empty lists everything.
 * @returns The infinite query; each page is one cursor's worth of entries.
 */
export function useRegistrySearch(registry: string, search: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.registrySearch(registry, search),
    queryFn: ({ pageParam }) =>
      api.searchRegistryServers(registry, { search: search || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.metadata?.nextCursor,
    enabled: registry.length > 0,
  });
}

/**
 * Lists every workspace.
 *
 * @returns The query; `data` is each workspace's config and endpoint path.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.listWorkspaces,
  });
}

/**
 * Gives a mutation a way to mark queries stale.
 *
 * @returns A function that invalidates every query under each key it is given.
 */
function useInvalidate() {
  const queryClient = useQueryClient();
  return (...keys: readonly (readonly string[])[]) => {
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/**
 * What a change to a server makes stale: the servers themselves, the router status, and the
 * workspaces — a workspace lists its members' tools, resources and prompts under its own key.
 */
const SERVER_CHANGE_KEYS = [queryKeys.servers, queryKeys.status, queryKeys.workspaces] as const;

/**
 * Installs a server.
 *
 * @returns The mutation; takes the install request, yields the new server's status, and invalidates everything a server
 * change makes stale.
 */
export function useInstallServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: InstallRequest) => api.installServer(body),
    onSuccess: () => invalidate(...SERVER_CHANGE_KEYS),
  });
}

/**
 * Changes a server's config.
 *
 * @returns The mutation; takes the server's `name` plus the fields to change, yields its status, and invalidates
 * everything a server change makes stale.
 */
export function useUpdateServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ name, ...body }: UpdateServerRequest & { name: string }) => api.updateServer(name, body),
    onSuccess: () => invalidate(...SERVER_CHANGE_KEYS),
  });
}

/**
 * Uninstalls a server.
 *
 * @returns The mutation; takes the server's name and invalidates everything a server change makes stale.
 */
export function useDeleteServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.deleteServer(name),
    onSuccess: () => invalidate(...SERVER_CHANGE_KEYS),
  });
}

/**
 * Restarts a server.
 *
 * @returns The mutation; takes the server's name, yields its status, and invalidates everything a server change makes
 * stale.
 */
export function useRestartServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.restartServer(name),
    onSuccess: () => invalidate(...SERVER_CHANGE_KEYS),
  });
}

/**
 * Health-checks a server by connecting (spawning it if needed) and listing its tools.
 *
 * @returns The mutation; takes the server's name, yields the tools listing, and invalidates everything a server change
 * makes stale, so state and tool count refresh.
 */
export function useTestServerConnection() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.getTools({ kind: SCOPE_SERVER, name }),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

/**
 * Runs one test call from the UI against a scope.
 *
 * @typeParam Body - What the call sends.
 * @typeParam Result - What the call answers.
 * @param scope - The server or workspace to call.
 * @param run - The API client function that makes the call.
 * @returns The mutation; takes the body, yields the result, and invalidates the scope's activity log (where the call
 * also lands), every server query and the router status.
 */
function useUiCall<Body, Result>(scope: CapabilityScope, run: (scope: CapabilityScope, body: Body) => Promise<Result>) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Body) => run(scope, body),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope), queryKeys.servers, queryKeys.status),
  });
}

/**
 * Calls a tool from the UI.
 *
 * @param scope - The server or workspace that serves the tool.
 * @returns The mutation; takes the tool and arguments, yields the tool's result. Invalidates as `useUiCall` does.
 */
export function useCallTool(scope: CapabilityScope) {
  return useUiCall(scope, api.callTool);
}

/**
 * Reads a resource from the UI.
 *
 * @param scope - The server or workspace that serves the resource.
 * @returns The mutation; takes which resource, yields its contents. Invalidates as `useUiCall` does.
 */
export function useReadResource(scope: CapabilityScope) {
  return useUiCall(scope, api.readResource);
}

/**
 * Renders a prompt from the UI.
 *
 * @param scope - The server or workspace that serves the prompt.
 * @returns The mutation; takes the prompt and arguments, yields its messages. Invalidates as `useUiCall` does.
 */
export function useGetPrompt(scope: CapabilityScope) {
  return useUiCall(scope, api.getPrompt);
}

/**
 * Empties a scope's proxied-call log.
 *
 * @param scope - The server or workspace.
 * @returns The mutation; takes nothing and invalidates the scope's activity log.
 */
export function useClearActivity(scope: CapabilityScope) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.clearActivity(scope),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope)),
  });
}

/**
 * Adds a registry.
 *
 * @returns The mutation; takes the registry to add, yields it as saved, and invalidates the registry list.
 */
export function useCreateRegistry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateRegistryRequest) => api.createRegistry(body),
    onSuccess: () => invalidate(queryKeys.registries),
  });
}

/**
 * Removes a registry.
 *
 * @returns The mutation; takes the registry's name and invalidates the registry list and its searches.
 */
export function useDeleteRegistry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.deleteRegistry(name),
    onSuccess: () => invalidate(queryKeys.registries),
  });
}

/**
 * Creates a workspace.
 *
 * @returns The mutation; takes the workspace to create, yields it as saved, and invalidates every workspace query.
 */
export function useCreateWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => api.createWorkspace(body),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

/**
 * Changes a workspace.
 *
 * @returns The mutation; takes the workspace's `slug` plus the fields to change, yields the workspace, and invalidates
 * every workspace query.
 */
export function useUpdateWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ slug, ...body }: UpdateWorkspaceRequest & { slug: string }) => api.updateWorkspace(slug, body),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

/**
 * Deletes a workspace.
 *
 * @returns The mutation; takes the workspace's slug and invalidates every workspace query.
 */
export function useDeleteWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (slug: string) => api.deleteWorkspace(slug),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

/**
 * Changes router settings.
 *
 * @returns The mutation; takes the settings to change, yields them as saved, and invalidates the router status.
 */
export function useUpdateSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => api.updateSettings(body),
    onSuccess: () => invalidate(queryKeys.status),
  });
}

/**
 * Makes the router re-read its config files.
 *
 * @returns The mutation; takes nothing, yields the reload result, and invalidates every query in the cache.
 */
export function useReloadConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.reloadConfig(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
