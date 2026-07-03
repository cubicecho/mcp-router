import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import { AddServerDialog } from '../add-server-dialog';

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddServerDialog open onOpenChange={() => {}} />
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
    fireEvent.change(screen.getByLabelText('Paste config (optional)'), { target: { value: config } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply config' }));

    await waitFor(() => expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx'));
    expect((screen.getByLabelText('Local name') as HTMLInputElement).value).toBe('filesystem');
    expect((screen.getByLabelText('Arguments (one per line)') as HTMLTextAreaElement).value).toBe(
      '-y\nserver-filesystem',
    );
    expect((screen.getByDisplayValue('ROOT') as HTMLInputElement).value).toBe('ROOT');
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
});
