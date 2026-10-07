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
  // A workspace lists its members' tools, resources and prompts, so a server change makes them stale too.
  it('marks a workspace capability listing stale after a server is deleted', async () => {
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
