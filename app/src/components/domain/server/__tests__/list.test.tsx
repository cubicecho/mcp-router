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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import * as api from '@/lib/api';
import { ServerList } from '../list';

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
        <ServerList servers={[server]} />
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

describe('ServerList test-connection button', () => {
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

    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');

    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    renderList();

    await user.click(await screen.findByLabelText('Test connection to my-server'));

    await waitFor(() => expect(toolsSpy).toHaveBeenCalledWith({ kind: 'server', name: 'my-server' }));
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith('my-server connected — 2 tools'));
  });
});
