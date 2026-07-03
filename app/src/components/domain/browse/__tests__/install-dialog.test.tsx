import type { RegistryServer } from '@mcp-router/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallDialog } from '@/components/domain/browse/install-dialog';
import * as api from '@/lib/api';

vi.mock('@/lib/api', { spy: true });

const SERVER: RegistryServer = {
  name: 'io.github.acme/weather-server',
  description: 'Weather tools',
  version: '1.2.3',
  packages: [
    {
      registryType: 'npm',
      identifier: '@acme/weather-server',
      version: '1.2.3',
      environmentVariables: [
        { name: 'WEATHER_API_KEY', description: 'API key', isRequired: true, isSecret: true },
        { name: 'UNITS', default: 'metric' },
      ],
    },
  ],
};

function renderDialog(onInstalled = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<InstallDialog registry="official" server={SERVER} open onOpenChange={vi.fn()} onInstalled={onInstalled} />, {
    wrapper,
  });
  return { onInstalled };
}

describe('InstallDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the local name from the registry name and validates it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    renderDialog();

    const nameInput = screen.getByLabelText('Local name');
    expect(nameInput).toHaveValue('weather-server');

    await user.clear(nameInput);
    await user.type(nameInput, 'Invalid Name!');

    expect(
      screen.getByText('lowercase alphanumerics, dots, dashes, underscores; must start alphanumeric'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    expect(api.installServer).not.toHaveBeenCalled();
  });

  it('renders env var inputs with secrets masked and defaults prefilled', () => {
    renderDialog();

    const secret = screen.getByLabelText(/WEATHER_API_KEY/);
    expect(secret).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/UNITS/)).toHaveValue('metric');
  });

  it('submits an InstallRequest with source.type registry and calls onInstalled', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    vi.mocked(api.installServer).mockResolvedValue({
      config: {
        name: 'weather-server',
        enabled: true,
        source: { type: 'registry', registry: 'official', serverName: SERVER.name },
        transport: { type: 'stdio', command: 'node', args: [] },
        env: {},
        envMeta: {},
      },
      state: 'stopped',
    });
    const { onInstalled } = renderDialog();

    await user.type(screen.getByLabelText(/WEATHER_API_KEY/), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith('weather-server'));
    expect(api.installServer).toHaveBeenCalledWith({
      name: 'weather-server',
      source: { type: 'registry', registry: 'official', serverName: SERVER.name, version: '1.2.3' },
      packageSelector: '0',
      env: { WEATHER_API_KEY: 'abc123', UNITS: 'metric' },
      enabled: true,
    });
  });
});
