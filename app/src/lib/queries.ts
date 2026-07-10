import type {
  CreateRegistryRequest,
  CreateWorkspaceRequest,
  InstallRequest,
  UpdateServerRequest,
  UpdateWorkspaceRequest,
} from '@mcp-router/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CapabilityScope } from './api';
import * as api from './api';

/** Root query key for a capability scope; capability keys hang off it. */
function scopeKey(scope: CapabilityScope): readonly [string, string] {
  return scope.kind === 'server' ? ['servers', scope.name] : ['workspaces', scope.slug];
}

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
  registryServerDetail: (registry: string, serverName: string) =>
    ['registries', registry, 'servers', serverName] as const,
  workspaces: ['workspaces'] as const,
  workspace: (slug: string) => ['workspaces', slug] as const,
};

// --- queries ---

export function useRouterStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval: 15_000,
  });
}

export function useServers() {
  return useQuery({
    queryKey: queryKeys.servers,
    queryFn: api.listServers,
    // Poll so the live call counts / last-called times stay current.
    refetchInterval: 5_000,
  });
}

export function useServer(name: string) {
  return useQuery({
    queryKey: queryKeys.server(name),
    queryFn: () => api.getServer(name),
    // Keep the detail page's state/pid live (crashes, idle shutdowns).
    refetchInterval: 10_000,
  });
}

/** Listing tools may spawn the downstream server(s) — allow it to be slow, never auto-retry. */
export function useCapabilityTools(scope: CapabilityScope) {
  return useQuery({
    queryKey: queryKeys.capabilityTools(scope),
    queryFn: () => api.getTools(scope),
    retry: false,
    staleTime: 60_000,
  });
}

/** Listing resources may spawn the downstream server(s) — allow it to be slow, never auto-retry. */
export function useCapabilityResources(scope: CapabilityScope) {
  return useQuery({
    queryKey: queryKeys.capabilityResources(scope),
    queryFn: () => api.getResources(scope),
    retry: false,
    staleTime: 60_000,
  });
}

/** Listing prompts may spawn the downstream server(s) — allow it to be slow, never auto-retry. */
export function useCapabilityPrompts(scope: CapabilityScope) {
  return useQuery({
    queryKey: queryKeys.capabilityPrompts(scope),
    queryFn: () => api.getPrompts(scope),
    retry: false,
    staleTime: 60_000,
  });
}

/** Proxied call log for a server or workspace (in-memory on the server); polls while the tab is open. */
export function useCapabilityActivity(scope: CapabilityScope) {
  return useQuery({
    queryKey: queryKeys.capabilityActivity(scope),
    queryFn: () => api.getActivity(scope),
    refetchInterval: 5_000,
  });
}

/** Single workspace detail; kept live so member/enabled changes reflect promptly. */
export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: queryKeys.workspace(slug),
    queryFn: () => api.getWorkspace(slug),
    refetchInterval: 10_000,
  });
}

export function useRegistries() {
  return useQuery({
    queryKey: queryKeys.registries,
    queryFn: api.listRegistries,
  });
}

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

export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.listWorkspaces,
  });
}

// --- mutations ---

function useInvalidate() {
  const queryClient = useQueryClient();
  return (...keys: readonly (readonly string[])[]) => {
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function useInstallServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: InstallRequest) => api.installServer(body),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

export function useUpdateServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ name, ...body }: UpdateServerRequest & { name: string }) => api.updateServer(name, body),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

export function useDeleteServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.deleteServer(name),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

export function useRestartServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.restartServer(name),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

/** Health check: connect (spawning if needed) and list tools; refreshes state + tool count. */
export function useTestServerConnection() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.getTools({ kind: 'server', name }),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

/** Run one tool from the UI; the call also lands in the scope's activity log. */
export function useCallTool(scope: CapabilityScope) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.callTool>[1]) => api.callTool(scope, body),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope), queryKeys.servers, queryKeys.status),
  });
}

/** Read one resource from the UI; the call also lands in the scope's activity log. */
export function useReadResource(scope: CapabilityScope) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.readResource>[1]) => api.readResource(scope, body),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope), queryKeys.servers, queryKeys.status),
  });
}

/** Get one prompt from the UI; the call also lands in the scope's activity log. */
export function useGetPrompt(scope: CapabilityScope) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.getPrompt>[1]) => api.getPrompt(scope, body),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope), queryKeys.servers, queryKeys.status),
  });
}

export function useClearActivity(scope: CapabilityScope) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.clearActivity(scope),
    onSuccess: () => invalidate(queryKeys.capabilityActivity(scope)),
  });
}

export function useCreateRegistry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateRegistryRequest) => api.createRegistry(body),
    onSuccess: () => invalidate(queryKeys.registries),
  });
}

export function useDeleteRegistry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.deleteRegistry(name),
    onSuccess: () => invalidate(queryKeys.registries),
  });
}

export function useCreateWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => api.createWorkspace(body),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

export function useUpdateWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ slug, ...body }: UpdateWorkspaceRequest & { slug: string }) => api.updateWorkspace(slug, body),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

export function useDeleteWorkspace() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (slug: string) => api.deleteWorkspace(slug),
    onSuccess: () => invalidate(queryKeys.workspaces),
  });
}

export function useUpdateSettings() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(body),
    onSuccess: () => invalidate(queryKeys.status),
  });
}

export function useReloadConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.reloadConfig(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
