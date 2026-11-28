import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ServerRuntimeState } from '@/__generated__/graphql';
import type { InstalledServer } from '@/lib/api';
import {
  appRoutes,
  capabilities,
  FILESYSTEM_ID,
  needsSignInServer,
  serverAnswer,
  serverRow,
  serverRuntime,
  signedInServer,
  stdioServer,
} from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

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
  parameters: { api: { ...appRoutes(), Server: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The title's bar is the only loading state: the body draws no placeholder rows under it.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Loading…' })).toBeInTheDocument();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    // The way back does not wait for the answer.
    await expect(canvas.getByRole('link', { name: 'Back to servers' })).toBeVisible();
  },
};

export const WhenTheServerDoesNotExist: Story = {
  parameters: { route: '/servers/missing', api: { ...appRoutes(), Server: serverAnswer(null) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Server not found' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'missing' })).toBeVisible();
    // The page's back button and the empty state's own way back both lead to the list.
    await expect(canvas.getAllByRole('link', { name: 'Back to servers' })).toHaveLength(2);
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
  },
};

export const WhenTheServerFailsToLoad: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      Server: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'The router could not read its servers'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load server')).toBeVisible();
    await expect(alert.getByText('The router could not read its servers')).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
  },
};

export const ShowsWhyTheServerFailed: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      Server: serverAnswer(stdioServer({ state: ServerRuntimeState.Error, lastError: 'spawn node ENOENT' })),
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
      UpdateServer: { updateServer: serverRow(stdioServer({ config: { ...stdioServer().config, enabled: false } })) },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('switch', { name: 'Enabled' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('UpdateServer', { name: 'filesystem', input: { enabled: false } }),
    );
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Disabled filesystem')).toBeVisible(),
    );
  },
};

export const EnablesADisabledServer: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      Server: serverAnswer(
        stdioServer({ config: { ...stdioServer().config, enabled: false }, state: ServerRuntimeState.Stopped }),
      ),
      UpdateServer: { updateServer: serverRow(stdioServer()) },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole('switch', { name: 'Enabled' });
    await expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('UpdateServer', { name: 'filesystem', input: { enabled: true } }),
    );
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('Enabled filesystem')).toBeVisible());
  },
};

export const RestartsTheServer: Story = {
  parameters: { api: { ...appRoutes(), RestartServer: { restartServer: serverRuntime(stdioServer()) } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Restart' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('RestartServer', { name: 'filesystem' }));
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Restarted filesystem')).toBeVisible(),
    );
  },
};

export const WhenTheRestartFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      RestartServer: apiError(
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
      UpdateServer: {
        updateServer: serverRow(stdioServer({ config: { ...stdioServer().config, env: { ROOT_DIR: '/srv/files' } } })),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rootDir = await canvas.findByRole('textbox', { name: /ROOT_DIR/ });
    await userEvent.clear(rootDir);
    await userEvent.type(rootDir, '/srv/files');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('UpdateServer', {
        name: 'filesystem',
        input: { env: { ROOT_DIR: '/srv/files' } },
      }),
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
  parameters: { api: { ...appRoutes(), DeleteServer: { deleteServer: { id: FILESYSTEM_ID } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete filesystem' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Delete filesystem?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('DeleteServer', { name: 'filesystem' });

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('DeleteServer', { name: 'filesystem' }));
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

/** The app's answers plus one OAuth-protected server, answering its listings as `status` would. */
function haRoutes(status: InstalledServer) {
  const refused = apiError(
    HttpStatus.BadGateway,
    ErrorCode.UpstreamFailed,
    'Server "home-assistant" needs you to sign in',
    'Open the server in MCP Router and choose Sign in.',
  );
  const signedIn = status.oauth?.signedIn === true;
  return {
    ...appRoutes(),
    Server: serverAnswer(status),
    ServerTools: signedIn ? { serverTools: capabilities.tools } : refused,
    ServerResources: signedIn ? { serverResources: capabilities.resources } : refused,
    ServerPrompts: signedIn ? { serverPrompts: capabilities.prompts } : refused,
    ServerActivity: { serverActivity: [] },
  };
}

export const AsksToSignInWhereTheServerWantsALogin: Story = {
  parameters: { route: '/servers/home-assistant', api: haRoutes(needsSignInServer()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Sign in required')).toBeVisible();
    await expect(canvas.getByText('needs sign-in')).toBeVisible();
    await expect(canvas.getByText('Not signed in')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  },
};

export const SignsOutOnlyAfterConfirming: Story = {
  parameters: {
    route: '/servers/home-assistant',
    api: {
      ...haRoutes(signedInServer()),
      SignOutServerOAuth: { signOutServerOAuth: serverRuntime(needsSignInServer()) },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Signed in')).toBeVisible();
    await expect(canvas.queryByText('Sign in required')).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Sign out of home-assistant' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('SignOutServerOAuth', { name: 'home-assistant' });
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('SignOutServerOAuth', { name: 'home-assistant' }));
  },
};
