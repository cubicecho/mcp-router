import type {
  CreateProjectRequest,
  CreateRegistryRequest,
  InstallRequest,
  UpdateProjectRequest,
  UpdateServerRequest,
} from '@mcp-router/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';

export const queryKeys = {
  status: ['status'] as const,
  servers: ['servers'] as const,
  server: (name: string) => ['servers', name] as const,
  serverTools: (name: string) => ['servers', name, 'tools'] as const,
  serverActivity: (name: string) => ['servers', name, 'activity'] as const,
  registries: ['registries'] as const,
  registrySearch: (registry: string, search: string) => ['registries', registry, 'search', search] as const,
  registryServerDetail: (registry: string, serverName: string) =>
    ['registries', registry, 'servers', serverName] as const,
  projects: ['projects'] as const,
  project: (slug: string) => ['projects', slug] as const,
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
    refetchInterval: 10_000,
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

/** Listing tools may spawn the downstream server — allow it to be slow, never auto-retry. */
export function useServerTools(name: string) {
  return useQuery({
    queryKey: queryKeys.serverTools(name),
    queryFn: () => api.getServerTools(name),
    retry: false,
    staleTime: 60_000,
  });
}

/** Per-server proxied call log (in-memory on the server); polls while the tab is open. */
export function useServerActivity(name: string) {
  return useQuery({
    queryKey: queryKeys.serverActivity(name),
    queryFn: () => api.getServerActivity(name),
    refetchInterval: 5_000,
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

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: api.listProjects,
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
    mutationFn: (name: string) => api.getServerTools(name),
    onSuccess: () => invalidate(queryKeys.servers, queryKeys.status),
  });
}

/** Run one tool from the UI; the call also lands in the server's activity log. */
export function useCallServerTool(name: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.callServerTool>[1]) => api.callServerTool(name, body),
    onSuccess: () => invalidate(queryKeys.serverActivity(name), queryKeys.servers, queryKeys.status),
  });
}

export function useClearServerActivity() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => api.clearServerActivity(name),
    onSuccess: (_data, name) => invalidate(queryKeys.serverActivity(name)),
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

export function useCreateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateProjectRequest) => api.createProject(body),
    onSuccess: () => invalidate(queryKeys.projects),
  });
}

export function useUpdateProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ slug, ...body }: UpdateProjectRequest & { slug: string }) => api.updateProject(slug, body),
    onSuccess: () => invalidate(queryKeys.projects),
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (slug: string) => api.deleteProject(slug),
    onSuccess: () => invalidate(queryKeys.projects),
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
