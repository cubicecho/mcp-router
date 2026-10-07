import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.ts';
import { queryKeys, useDeleteServer } from '../queries.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server mutations', () => {
  // Known gap (B3), not fixed here: a server mutation refreshes the server list and the status but
  // not the workspaces, so a workspace's cached tools, resources and prompts keep showing a deleted
  // or changed server's entries until they go stale. `it.fails` keeps the suite green while the gap
  // stands and goes red once it is closed.
  it.fails('marks a workspace capability listing stale after a server is deleted', async () => {
    vi.spyOn(api, 'deleteServer').mockResolvedValue(undefined);
    const queryClient = new QueryClient();
    const toolsKey = queryKeys.capabilityTools({ kind: 'workspace', slug: 'acme' });
    queryClient.setQueryData(toolsKey, { tools: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useDeleteServer(), { wrapper });
    result.current.mutate('io.github.echo');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(toolsKey)?.isInvalidated).toBe(true);
  });
});
