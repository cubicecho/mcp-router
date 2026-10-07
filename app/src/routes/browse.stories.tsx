import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, emptyRegistryPage, registry, registryPage, stdioServer } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const SEARCH_ROUTE = 'GET /api/registries/official/servers';

/** How many times the story has asked the registry for a page of servers. */
function searchCount(): number {
  return apiRequest.mock.calls.filter(([key]) => key === SEARCH_ROUTE).length;
}

const meta = {
  title: 'routes/browse',
  parameters: { route: '/browse', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsTheRegistryServers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Browse' })).toBeVisible();
    await expect(await canvas.findByText('Weather')).toBeVisible();
    await expect(canvas.getByText('Notes')).toBeVisible();
    await expect(canvas.getByRole('tab', { name: 'From registry', selected: true })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Browse', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const SearchesTheRegistryOnSubmit: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      // The registry answers a search for "notes" with the one server that matches it.
      [SEARCH_ROUTE]: ({ url }: { url: URL }) => {
        const page = registryPage();
        return url.searchParams.get('search') === 'notes'
          ? { ...page, servers: page.servers.filter((entry) => entry.server.title === 'Notes') }
          : page;
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Weather')).toBeVisible();
    const searchesBefore = searchCount();

    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search servers' }), 'notes');
    // Typing alone does not hit the registry.
    await expect(searchCount()).toBe(searchesBefore);
    await expect(canvas.getByText('Weather')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(canvas.queryByText('Weather')).not.toBeInTheDocument());
    await expect(canvas.getByText('Notes')).toBeVisible();
    await expect(searchCount()).toBe(searchesBefore + 1);
  },
};

export const WhileSearching: Story = {
  parameters: { api: { ...appRoutes(), [SEARCH_ROUTE]: pending() } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('status')).toBeVisible();
  },
};

export const WithNoMatchingServers: Story = {
  parameters: { api: { ...appRoutes(), [SEARCH_ROUTE]: emptyRegistryPage() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('No servers found')).toBeVisible();
    await expect(canvas.getByText('Try another search term or registry.')).toBeVisible();
  },
};

export const WhenTheRegistryCannotBeReached: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [SEARCH_ROUTE]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'Registry "official" did not answer'),
    },
  },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load search results')).toBeVisible();
    await expect(alert.getByText('Registry "official" did not answer')).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

export const WhenTheRegistryListFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'GET /api/registries': apiError(
        HttpStatus.InternalServerError,
        ErrorCode.Internal,
        'registries.json is unreadable',
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load registries')).toBeVisible();
    await expect(alert.getByText('registries.json is unreadable')).toBeVisible();
    // With no registry to search there is nothing to submit.
    await expect(canvas.getByRole('button', { name: 'Search' })).toBeDisabled();
  },
};

export const SearchesAnotherRegistry: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'GET /api/registries': [registry(), registry({ name: 'mirror', url: 'https://mirror.example.test' })],
      'GET /api/registries/mirror/servers': emptyRegistryPage(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByText('Weather')).toBeVisible();

    await userEvent.click(canvas.getByRole('combobox', { name: 'Registry' }));
    await userEvent.click(await body.findByRole('option', { name: 'mirror' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('GET /api/registries/mirror/servers', undefined));
    await expect(await canvas.findByText('No servers found')).toBeVisible();
    // The list hides the rest of the page from assistive tech until it has finished closing.
    await waitFor(() => expect(body.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

export const InstallsAPackageFromNpm: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'POST /api/servers': stdioServer(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('tab', { name: 'From npm' }));
    const install = await canvas.findByRole('button', { name: 'Install' });
    await expect(install).toBeDisabled();

    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@modelcontextprotocol/server-filesystem');
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Local name' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Local name' }), 'filesystem');
    await userEvent.click(install);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('POST /api/servers', {
        name: 'filesystem',
        source: { type: 'npm', package: '@modelcontextprotocol/server-filesystem' },
        env: {},
        enabled: true,
      }),
    );
    // A finished install lands on the new server's page.
    await expect(await canvas.findByRole('heading', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Servers', current: 'page' })).toBeVisible();
  },
};
