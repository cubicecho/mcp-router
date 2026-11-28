import type { ServerStatus } from '@mcp-router/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as api from '@/lib/api';
import { ServerList } from '../list.tsx';

const server: ServerStatus = {
  config: {
    name: 'my-server',
    enabled: true,
    source: { type: 'remote' },
    transport: { type: 'streamable-http', url: 'http://localhost:8080/mcp', headers: {} },
    env: {},
    envMeta: {},
  },
  state: 'running',
  toolCount: 0,
} as ServerStatus;

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <TooltipProvider>
        <ToastProvider>
          <ServerList servers={[server]} />
        </ToastProvider>
      </TooltipProvider>
    ),
  });
  const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/servers/$name', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={client}>
      {/* biome-ignore lint/suspicious/noExplicitAny: test router typing */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

describe('ServerList row actions menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the downstream tools when clicked and reports the count', async () => {
    const toolsSpy = vi.spyOn(api, 'getTools').mockResolvedValue({
      tools: [
        { name: 'echo', description: '' },
        { name: 'add', description: '' },
      ],
    });

    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Actions for my-server' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Test connection' }));

    await waitFor(() => expect(toolsSpy).toHaveBeenCalledWith({ kind: 'server', name: 'my-server' }));
    expect(await screen.findByText('my-server connected — 2 tools')).toBeInTheDocument();
  });

  it('asks before deleting, and deletes only once confirmed', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteServer').mockResolvedValue(undefined);

    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    renderList();

    await user.click(await screen.findByRole('button', { name: 'Actions for my-server' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete my-server?' });
    expect(deleteSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('my-server'));
  });
});
