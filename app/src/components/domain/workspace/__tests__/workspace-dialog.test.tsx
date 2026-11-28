import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledServer, WorkspaceView } from '@/lib/api';
import * as api from '@/lib/api';
import { WorkspaceDialog } from '../workspace-dialog.tsx';

// Dotted names on purpose: they are legal server names, and a form path would split on them.
const ECHO_ID = '00000000-0000-4000-8000-000000000001';
const REMOTE_ID = '00000000-0000-4000-8000-000000000002';
const SERVERS = [
  {
    id: ECHO_ID,
    config: { name: 'io.github.echo', transport: { type: 'stdio', command: 'node', args: [] } },
    state: 'STOPPED',
  },
  {
    id: REMOTE_ID,
    config: { name: 'acme.remote', transport: { type: 'streamable-http', url: 'https://acme.test/mcp', headers: {} } },
    state: 'STOPPED',
  },
] as unknown as InstalledServer[];

const WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a1';
const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Acme',
  slug: 'acme',
  enabled: true,
  description: null,
  path: '/mcp/w/acme',
  members: { 'io.github.echo': { enabled: true, env: { API_KEY: 'one' }, serverId: ECHO_ID } },
} as WorkspaceView;

function renderDialog(workspace?: WorkspaceView) {
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
    const createSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue({ name: 'Backend' } as never);
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
      description: null,
      members: [
        { serverId: ECHO_ID, enabled: true, env: { API_KEY: 'two' } },
        { serverId: REMOTE_ID, enabled: true, url: 'https://acme.test/mcp/team' },
      ],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prefills an existing workspace and drops a member that is switched off', async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue({ name: 'Acme' } as never);
    renderDialog(WORKSPACE);

    const echo = await screen.findByRole('switch', { name: 'Include io.github.echo' });
    expect(echo).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Overrides' }));
    expect(screen.getByLabelText('Env overrides (KEY=VALUE per line)')).toHaveValue('API_KEY=one');

    await user.click(echo);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith({
      id: WORKSPACE_ID,
      slug: 'acme',
      name: 'Acme',
      enabled: true,
      description: null,
      members: [],
    });
  });

  it('keeps a member that is switched off on the workspace page, with its overrides', async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue({ name: 'Acme' } as never);
    const members = { 'io.github.echo': { enabled: false, env: { API_KEY: 'one' }, serverId: ECHO_ID } };
    renderDialog({ ...WORKSPACE, members });

    expect(await screen.findByRole('switch', { name: 'Include io.github.echo' })).toBeChecked();
    expect(screen.getByText('disabled')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ members: [{ serverId: ECHO_ID, enabled: false, env: { API_KEY: 'one' } }] }),
    );
  });

  it('sends an emptied description as null so the server clears it, and reports the saved workspace', async () => {
    const user = userEvent.setup();
    const saved = { name: 'Acme', slug: 'acme' };
    const updateSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue(saved as never);
    const onSaved = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WorkspaceDialog
          open
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          workspace={{ ...WORKSPACE, description: 'Team servers' }}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole('switch', { name: 'Include io.github.echo' });
    await user.clear(screen.getByLabelText('Description (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  // The members to save are rebuilt from the installed-server list, so a save made before that list has
  // loaded (or while it is failing) must resend the ones the workspace has: an empty list would empty it.
  it('keeps the members it has when saved before the server list has loaded', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listServers').mockReturnValue(new Promise(() => {}));
    const updateSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue({ name: 'Acme' } as never);
    renderDialog(WORKSPACE);

    await user.type(screen.getByLabelText('Description (optional)'), 'Team servers');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith({
      id: WORKSPACE_ID,
      slug: 'acme',
      name: 'Acme',
      enabled: true,
      description: 'Team servers',
      members: [{ serverId: ECHO_ID, enabled: true, env: { API_KEY: 'one' } }],
    });
  });

  it('does not report an empty server list while it is still loading', () => {
    vi.spyOn(api, 'listServers').mockReturnValue(new Promise(() => {}));
    renderDialog(WORKSPACE);

    expect(screen.queryByText('No servers installed yet.')).not.toBeInTheDocument();
  });

  it('does not submit a name that produces no slug', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, 'saveWorkspace').mockResolvedValue({ name: 'x' } as never);
    renderDialog();

    await user.type(screen.getByLabelText(/^Workspace name/), '!!!');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Enter a workspace name that produces a valid URL slug')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
