import type { ServerStatus } from '@mcp-router/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import { AddServerDialog } from '../add-server-dialog';

function renderDialog(server?: ServerStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddServerDialog open onOpenChange={() => {}} server={server} />
    </QueryClientProvider>,
  );
}

describe('AddServerDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits a stdio command server as a remote source with a stdio transport', async () => {
    const installSpy = vi.spyOn(api, 'installServer').mockResolvedValue({
      config: { name: 'my-server' },
    } as never);

    renderDialog();

    fireEvent.change(screen.getByLabelText('Local name'), { target: { value: 'my-server' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('Arguments (one per line)'), { target: { value: '-y\nsome-mcp-server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));

    await waitFor(() => expect(installSpy).toHaveBeenCalledTimes(1));
    expect(installSpy).toHaveBeenCalledWith({
      name: 'my-server',
      source: { type: 'remote' },
      transport: { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp-server'], cwd: undefined },
      env: {},
      enabled: true,
    });
  });

  it('applies a pasted claude_desktop_config entry into the form', async () => {
    renderDialog();

    const config = JSON.stringify({
      mcpServers: { filesystem: { command: 'npx', args: ['-y', 'server-filesystem'], env: { ROOT: '/tmp' } } },
    });
    fireEvent.change(screen.getByLabelText('Paste a config'), { target: { value: config } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply config' }));

    await waitFor(() => expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx'));
    expect((screen.getByLabelText('Local name') as HTMLInputElement).value).toBe('filesystem');
    expect((screen.getByLabelText('Arguments (one per line)') as HTMLTextAreaElement).value).toBe(
      '-y\nserver-filesystem',
    );
    expect((screen.getByDisplayValue('ROOT') as HTMLInputElement).value).toBe('ROOT');
  });

  it('applies a named single-server entry (no mcpServers wrapper)', async () => {
    renderDialog();

    const config = JSON.stringify({
      sequentialthinking: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    });
    fireEvent.change(screen.getByLabelText('Paste a config'), { target: { value: config } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply config' }));

    await waitFor(() => expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx'));
    expect((screen.getByLabelText('Local name') as HTMLInputElement).value).toBe('sequentialthinking');
    expect((screen.getByLabelText('Arguments (one per line)') as HTMLTextAreaElement).value).toBe(
      '-y\n@modelcontextprotocol/server-sequential-thinking',
    );
  });

  it('applies a bare config and tolerates a trailing comma', async () => {
    renderDialog();

    // Bare `{ command, args }` with a trailing comma (a common copy-paste artifact).
    const config = '{\n  "command": "npx",\n  "args": ["-y", "server-sequential-thinking"],\n}';
    fireEvent.change(screen.getByLabelText('Paste a config'), { target: { value: config } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply config' }));

    await waitFor(() => expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx'));
    // No name key in a bare config, so the name field is left empty for the user.
    expect((screen.getByLabelText('Local name') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Arguments (one per line)') as HTMLTextAreaElement).value).toBe(
      '-y\nserver-sequential-thinking',
    );
  });

  it('submits an HTTP server as a remote source with a streamable-http transport', async () => {
    const installSpy = vi.spyOn(api, 'installServer').mockResolvedValue({
      config: { name: 'local-http' },
    } as never);

    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    renderDialog();

    fireEvent.change(screen.getByLabelText('Local name'), { target: { value: 'local-http' } });
    await user.click(screen.getByRole('tab', { name: 'HTTP (streamable)' }));
    fireEvent.change(await screen.findByLabelText('Server URL'), { target: { value: 'http://localhost:8080/mcp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));

    await waitFor(() => expect(installSpy).toHaveBeenCalledTimes(1));
    expect(installSpy).toHaveBeenCalledWith({
      name: 'local-http',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'http://localhost:8080/mcp', headers: {} },
      env: {},
      enabled: true,
    });
  });

  it('prefills from an existing server and PATCHes changes without installing', async () => {
    const updateSpy = vi.spyOn(api, 'updateServer').mockResolvedValue({ config: { name: 'my-server' } } as never);
    const installSpy = vi.spyOn(api, 'installServer');

    const server = {
      config: {
        name: 'my-server',
        enabled: true,
        source: { type: 'npm', package: 'some-mcp-server' },
        transport: { type: 'stdio', command: 'node', args: ['/path/bin.js'], cwd: undefined },
        env: { API_KEY: 'old' },
        envMeta: {},
      },
      state: 'running',
    } as ServerStatus;

    renderDialog(server);

    // Name is prefilled and locked; the command is prefilled and editable.
    const nameInput = screen.getByLabelText('Local name') as HTMLInputElement;
    expect(nameInput.value).toBe('my-server');
    expect(nameInput).toBeDisabled();
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('node');
    expect((screen.getByDisplayValue('old') as HTMLInputElement).value).toBe('old');

    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith('my-server', {
      transport: { type: 'stdio', command: 'node', args: ['/path/bin.js'], cwd: undefined },
      env: { API_KEY: 'new-secret' },
    });
    expect(installSpy).not.toHaveBeenCalled();
  });
});
