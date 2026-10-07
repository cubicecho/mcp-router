import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { registryServer, stdioServer } from '@/storybook/fixtures';
import { apiRequest, pending } from '@/storybook/mock-api';
import { RegistryServerCard } from './server-card.tsx';

const SERVERS_ROUTE = 'GET /api/servers';
const INSTALL_ROUTE = 'POST /api/servers';
const REGISTRY_NAME = 'io.github.example/weather';

/** The fixture server as an install of the weather registry entry. */
function installedWeather() {
  return stdioServer({
    config: {
      ...stdioServer({ name: 'weather' }).config,
      source: { type: 'registry', registry: 'official', serverName: REGISTRY_NAME, version: '1.2.0' },
    },
  });
}

const meta = {
  component: RegistryServerCard,
  args: { registry: 'official', server: registryServer(), onInstalled: fn() },
  parameters: { api: { [SERVERS_ROUTE]: [stdioServer()] } },
  decorators: [
    (Story) => (
      <div className="max-w-md p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RegistryServerCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DescribesTheRegistryEntry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Weather' })).toBeVisible();
    await expect(canvas.getByText(REGISTRY_NAME)).toBeVisible();
    await expect(canvas.getByText('v1.2.0')).toBeVisible();
    await expect(canvas.getByText('Forecasts for any city.')).toBeVisible();
    await expect(canvas.getByText('npm: @example/weather-mcp')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Repository' })).toHaveAttribute(
      'href',
      'https://github.com/example/weather',
    );
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled();
    await expect(canvas.queryByText('Installed')).not.toBeInTheDocument();
  },
};

export const ARemoteEntryWithItsOwnWebsite: Story = {
  args: {
    server: registryServer({
      name: 'io.github.example/notes',
      title: 'Notes',
      description: 'A hosted notebook.',
      version: '0.4.0',
      websiteUrl: 'https://notes.example.test',
      packages: [],
      remotes: [{ type: 'streamable-http', url: 'https://notes.example.test/mcp' }],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Notes' })).toBeVisible();
    await expect(canvas.getByText('remote: https://notes.example.test/mcp')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://notes.example.test');
    await expect(canvas.queryByRole('link', { name: 'Repository' })).not.toBeInTheDocument();
  },
};

export const ABareEntryWithNothingToLinkTo: Story = {
  args: {
    server: registryServer({ title: undefined, description: undefined, version: undefined, repository: undefined }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // With no title the registry name is the heading.
    await expect(canvas.getByRole('heading', { name: REGISTRY_NAME })).toBeVisible();
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled();
  },
};

export const LinksToTheInstalledCopy: Story = {
  parameters: { api: { [SERVERS_ROUTE]: [stdioServer(), installedWeather()] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Installed')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'View weather' })).toHaveAttribute('href', '/servers/weather');
    await expect(canvas.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  },
};

export const OffersInstallWhileTheInstalledServersLoad: Story = {
  parameters: { api: { [SERVERS_ROUTE]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled();
    await expect(canvas.queryByText('Installed')).not.toBeInTheDocument();
  },
};

export const InstallsThroughTheDialog: Story = {
  parameters: { api: { [SERVERS_ROUTE]: [stdioServer()], [INSTALL_ROUTE]: installedWeather() } },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Install' }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.type(dialog.getByLabelText(/^WEATHER_API_KEY/), 'abc123');
    await userEvent.click(dialog.getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        INSTALL_ROUTE,
        expect.objectContaining({
          name: 'weather',
          source: { type: 'registry', registry: 'official', serverName: REGISTRY_NAME, version: '1.2.0' },
          env: { WEATHER_API_KEY: 'abc123' },
        }),
      ),
    );
    await waitFor(() => expect(args.onInstalled).toHaveBeenCalledWith('weather'));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const CancellingTheDialogInstallsNothing: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Install' }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
    await expect(apiRequest).not.toHaveBeenCalledWith(INSTALL_ROUTE, expect.anything());
    await expect(args.onInstalled).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled();
  },
};
