import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import { RegistrySearch } from '../browse';

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RegistrySearch onInstalled={() => {}} />
    </QueryClientProvider>,
  );
}

describe('RegistrySearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listRegistries').mockResolvedValue([{ name: 'official', url: 'https://example.test' }]);
  });

  it('searches only on submit, not on every keystroke', async () => {
    const searchSpy = vi
      .spyOn(api, 'searchRegistryServers')
      .mockResolvedValue({ servers: [], metadata: { count: 0 } } as never);

    renderSearch();

    // Initial mount fires one search (the empty/browse-all query).
    await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(1));
    expect(searchSpy).toHaveBeenLastCalledWith('official', { search: undefined, cursor: undefined, limit: 20 });

    // Typing must not hit the registry.
    fireEvent.change(screen.getByPlaceholderText('Search servers…'), { target: { value: 'filesystem' } });
    fireEvent.change(screen.getByPlaceholderText('Search servers…'), { target: { value: 'file' } });
    await Promise.resolve();
    expect(searchSpy).toHaveBeenCalledTimes(1);

    // Submitting does.
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
    expect(searchSpy).toHaveBeenLastCalledWith('official', { search: 'file', cursor: undefined, limit: 20 });
  });
});
