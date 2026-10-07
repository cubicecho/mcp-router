import type { ServerStatus, WorkspaceStatus } from '@mcp-router/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import { WorkspaceDialog } from '../workspace-dialog.tsx';

// Dotted names on purpose: they are legal server names, and a form path would split on them.
const SERVERS = [
  { config: { name: 'io.github.echo', transport: { type: 'stdio', command: 'node', args: [] } }, state: 'stopped' },
  {
    config: { name: 'acme.remote', transport: { type: 'streamable-http', url: 'https://acme.test/mcp', headers: {} } },
    state: 'stopped',
  },
] as unknown as ServerStatus[];

const WORKSPACE = {
  name: 'Acme',
  slug: 'acme',
  enabled: true,
  path: '/mcp/w/acme',
  members: { 'io.github.echo': { enabled: true, env: { API_KEY: 'one' } } },
} as unknown as WorkspaceStatus;

function renderDialog(workspace?: WorkspaceStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <WorkspaceDialog open onOpenChange={onOpenChange} workspace={workspace} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe('WorkspaceDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listServers').mockResolvedValue(SERVERS);
  });

  it('creates a workspace from the switched-on servers and their overrides', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, 'createWorkspace').mockResolvedValue({ name: 'Backend' } as never);
    const onOpenChange = renderDialog();

    await user.type(screen.getByLabelText(/^Workspace name/), 'Backend');
    expect(screen.getByText('/mcp/w/backend')).toBeInTheDocument();

    await user.click(await screen.findByRole('switch', { name: 'Include io.github.echo' }));
    await user.click(screen.getByRole('button', { name: 'Overrides' }));
    await user.type(screen.getByLabelText('Env overrides (KEY=VALUE per line)'), 'API_KEY=two');

    // A remote member's URL override starts at the base URL, and is only saved once it differs.
    await user.click(screen.getByRole('switch', { name: 'Include acme.remote' }));
    await user.click(screen.getAllByRole('button', { name: 'Overrides' })[1] as HTMLElement);
    expect(screen.getByLabelText('URL override')).toHaveValue('https://acme.test/mcp');
    await user.type(screen.getByLabelText('URL override'), '/team');

    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith({
      name: 'Backend',
      enabled: true,
      description: undefined,
      members: {
        'io.github.echo': { enabled: true, env: { API_KEY: 'two' } },
        'acme.remote': { enabled: true, url: 'https://acme.test/mcp/team' },
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prefills an existing workspace and drops a member that is switched off', async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api, 'updateWorkspace').mockResolvedValue({ name: 'Acme' } as never);
    renderDialog(WORKSPACE);

    const echo = await screen.findByRole('switch', { name: 'Include io.github.echo' });
    expect(echo).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Overrides' }));
    expect(screen.getByLabelText('Env overrides (KEY=VALUE per line)')).toHaveValue('API_KEY=one');

    await user.click(echo);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith('acme', {
      name: 'Acme',
      enabled: true,
      description: undefined,
      members: {},
    });
  });

  // Known bug (B2), not fixed here: the members to save are rebuilt from the installed-server list, so a
  // save made before that list has loaded (or while it is failing) sends no members at all and empties
  // the workspace. `it.fails` keeps the suite green while the bug stands and goes red once it is fixed.
  it.fails('keeps the existing members when saved before the server list has loaded', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listServers').mockReturnValue(new Promise(() => {}));
    const updateSpy = vi.spyOn(api, 'updateWorkspace').mockResolvedValue({ name: 'Acme' } as never);
    renderDialog(WORKSPACE);

    await user.type(screen.getByLabelText('Description (optional)'), 'Team servers');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ members: { 'io.github.echo': { enabled: true, env: { API_KEY: 'one' } } } }),
    );
  });

  it('does not submit a name that produces no slug', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, 'createWorkspace').mockResolvedValue({ name: 'x' } as never);
    renderDialog();

    await user.type(screen.getByLabelText(/^Workspace name/), '!!!');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Enter a workspace name that produces a valid URL slug')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
