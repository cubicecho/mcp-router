import type { ActivityEntry } from '@mcp-router/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as api from '@/lib/api';
import { ActivityCard } from '../activity-card.tsx';

const entry: ActivityEntry = {
  id: 1,
  at: '2026-10-06T12:00:00.000Z',
  via: 'direct',
  method: 'tools/call',
  target: 'echo',
  ok: true,
  durationMs: 12,
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ActivityCard scope={{ kind: 'server', name: 'echo-server' }} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('ActivityCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getActivity').mockResolvedValue({ entries: [entry] });
  });

  it('asks before clearing the log, and clears nothing on Cancel', async () => {
    const clearActivity = vi.spyOn(api, 'clearActivity').mockResolvedValue();
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Clear activity' }));
    expect(await screen.findByRole('alertdialog', { name: 'Clear the activity log?' })).toBeInTheDocument();
    expect(clearActivity).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(clearActivity).not.toHaveBeenCalled();
  });

  it('clears the log once confirmed', async () => {
    const clearActivity = vi.spyOn(api, 'clearActivity').mockResolvedValue();
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Clear activity' }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(clearActivity).toHaveBeenCalledWith({ kind: 'server', name: 'echo-server' }));
  });
});
