import { ErrorCode, HttpStatus, ServerRuntimeState } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, stdioServer } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const SERVER_ROUTE = '/api/servers/filesystem';

const meta = {
  title: 'routes/servers-name',
  parameters: { route: '/servers/filesystem', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.getByText('Read and write files under one folder.')).toBeVisible();
    await expect(await canvas.findByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(canvas.getByText(/\/mcp\/filesystem$/)).toBeVisible();
    await expect(canvas.getByText('stdio — node index.js /tmp')).toBeVisible();
    await expect(canvas.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    await expect(canvas.getByRole('textbox', { name: /ROOT_DIR/ })).toHaveValue('/tmp');
    await expect(canvas.getByRole('tab', { name: 'Tools', selected: true })).toBeVisible();
    await expect(await canvas.findByText('read_file')).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const ShowsARemoteServerWithoutAnEnvironment: Story = {
  parameters: { route: '/servers/docs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'docs' })).toBeVisible();
    await expect(await canvas.findByText('streamable-http — https://docs.example.test/mcp')).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Environment variables' })).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), [`GET ${SERVER_ROUTE}`]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    // The way back does not wait for the answer.
    await expect(canvas.getByRole('link', { name: 'Back to servers' })).toBeVisible();
  },
};

export const WhenTheServerDoesNotExist: Story = {
  parameters: {
    route: '/servers/missing',
    api: {
      ...appRoutes(),
      'GET /api/servers/missing': apiError(HttpStatus.NotFound, ErrorCode.NotFound, 'Server "missing" not found'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load server')).toBeVisible();
    await expect(alert.getByText('Server "missing" not found')).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'missing' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
  },
};

export const ShowsWhyTheServerFailed: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`GET ${SERVER_ROUTE}`]: stdioServer({ state: ServerRuntimeState.Error, lastError: 'spawn node ENOENT' }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Last error')).toBeVisible();
    await expect(canvas.getAllByText('spawn node ENOENT')[0]).toBeVisible();
  },
};

export const DisablesTheServer: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`PATCH ${SERVER_ROUTE}`]: stdioServer({
        config: { ...stdioServer().config, enabled: false },
        state: ServerRuntimeState.Stopped,
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('switch', { name: 'Enabled' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`PATCH ${SERVER_ROUTE}`, { enabled: false }));
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Disabled filesystem')).toBeVisible(),
    );
  },
};

export const EnablesADisabledServer: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`GET ${SERVER_ROUTE}`]: stdioServer({
        config: { ...stdioServer().config, enabled: false },
        state: ServerRuntimeState.Stopped,
      }),
      [`PATCH ${SERVER_ROUTE}`]: stdioServer(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole('switch', { name: 'Enabled' });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`PATCH ${SERVER_ROUTE}`, { enabled: true }));
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('Enabled filesystem')).toBeVisible());
  },
};

export const RestartsTheServer: Story = {
  parameters: { api: { ...appRoutes(), [`POST ${SERVER_ROUTE}/restart`]: stdioServer() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Restart' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`POST ${SERVER_ROUTE}/restart`, undefined));
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Restarted filesystem')).toBeVisible(),
    );
  },
};

export const WhenTheRestartFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`POST ${SERVER_ROUTE}/restart`]: apiError(
        HttpStatus.BadGateway,
        ErrorCode.UpstreamFailed,
        'Failed to connect to server "filesystem"',
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Restart' }));
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).getByText('Failed to connect to server "filesystem"'),
      ).toBeVisible(),
    );
  },
};

export const SavesTheEnvironment: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`PATCH ${SERVER_ROUTE}`]: stdioServer({
        config: { ...stdioServer().config, env: { ROOT_DIR: '/srv/files' } },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rootDir = await canvas.findByRole('textbox', { name: /ROOT_DIR/ });
    await userEvent.clear(rootDir);
    await userEvent.type(rootDir, '/srv/files');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(`PATCH ${SERVER_ROUTE}`, { env: { ROOT_DIR: '/srv/files' } }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Environment saved')).toBeVisible());
    // The change needs a restart, and the toast offers one.
    const toasts = within(body.getByRole('region', { name: /Notifications/ }));
    await expect(toasts.getByRole('button', { name: 'Restart' })).toBeVisible();
  },
};

export const OpensTheEditDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit' }));

    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Edit filesystem' }),
    );
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  },
};

export const DeletesOnlyAfterConfirming: Story = {
  parameters: { api: { ...appRoutes(), [`DELETE ${SERVER_ROUTE}`]: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete filesystem' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Delete filesystem?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith(`DELETE ${SERVER_ROUTE}`, undefined);

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`DELETE ${SERVER_ROUTE}`, undefined));
    await waitFor(() => expect(body.getByText('Deleted filesystem')).toBeVisible());
    // A deleted server has no page: the app goes back to the list.
    await expect(await canvas.findByRole('heading', { name: 'Servers' })).toBeVisible();
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const GoesBackToTheServers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('link', { name: 'Back to servers' }));
    await expect(await canvas.findByRole('heading', { name: 'Servers' })).toBeVisible();
  },
};
