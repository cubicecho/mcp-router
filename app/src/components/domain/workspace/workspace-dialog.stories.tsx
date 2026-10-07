import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { remoteServer, routerStatus, stdioServer, workspace } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { WorkspaceDialog } from './workspace-dialog.tsx';

const SERVERS_ROUTE = 'GET /api/servers';
const CREATE_ROUTE = 'POST /api/workspaces';
const UPDATE_ROUTE = 'PATCH /api/workspaces/research';
const ENV_OVERRIDES = 'Env overrides (KEY=VALUE per line)';

const routes = {
  [SERVERS_ROUTE]: [stdioServer(), remoteServer()],
  'GET /api/status': routerStatus(),
  [CREATE_ROUTE]: workspace({ name: 'Backend', slug: 'backend', path: '/mcp/w/backend' }),
  [UPDATE_ROUTE]: workspace(),
};

const meta = {
  component: WorkspaceDialog,
  args: { open: true, onOpenChange: fn() },
  parameters: { api: routes },
} satisfies Meta<typeof WorkspaceDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StartsEmptyWithEveryServerOff: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await expect(dialog.getByRole('textbox', { name: /^Workspace name/ })).toHaveValue('');
    await expect(dialog.getByText('Enter a name to generate the URL')).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    await expect(await dialog.findByRole('switch', { name: 'Include filesystem' })).not.toBeChecked();
    await expect(dialog.getByRole('switch', { name: 'Include docs' })).not.toBeChecked();
    // Overrides are offered only for a server that is in the workspace.
    await expect(dialog.queryByRole('button', { name: 'Overrides' })).not.toBeInTheDocument();
  },
};

export const CreatesAWorkspaceFromTheChosenServers: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), 'Backend');
    await expect(dialog.getByText('/mcp/w/backend')).toBeVisible();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Description (optional)' }), 'Team servers');

    await userEvent.click(await dialog.findByRole('switch', { name: 'Include filesystem' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Overrides' }));
    await userEvent.type(dialog.getByRole('textbox', { name: ENV_OVERRIDES }), 'ROOT_DIR=/srv/backend');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(CREATE_ROUTE, {
        name: 'Backend',
        enabled: true,
        description: 'Team servers',
        members: { filesystem: { enabled: true, env: { ROOT_DIR: '/srv/backend' } } },
      }),
    );
    await waitFor(() => expect(body.getByText('Created workspace Backend')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const SavesAUrlOverrideOnlyOnceItDiffers: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), 'Backend');
    await userEvent.click(await dialog.findByRole('switch', { name: 'Include docs' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Overrides' }));
    // The override starts at the server's own URL, so extending it is typing the tail.
    const url = dialog.getByRole('textbox', { name: 'URL override' });
    await expect(url).toHaveValue('https://docs.example.test/mcp');
    await userEvent.type(url, '/team');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(CREATE_ROUTE, {
        name: 'Backend',
        enabled: true,
        members: { docs: { enabled: true, url: 'https://docs.example.test/mcp/team' } },
      }),
    );
  },
};

export const RejectsANameThatMakesNoUrl: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    const name = dialog.getByRole('textbox', { name: /^Workspace name/ });
    await userEvent.type(name, '!!!');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));
    await expect(await dialog.findByText('Enter a workspace name that produces a valid URL slug')).toBeVisible();
    await expect(name).toBeInvalid();
    await expect(apiRequest).not.toHaveBeenCalledWith(CREATE_ROUTE, expect.anything());
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

export const WithNoServersInstalled: Story = {
  parameters: { api: { ...routes, [SERVERS_ROUTE]: [] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await expect(await dialog.findByText('No servers installed yet.')).toBeVisible();
    await expect(dialog.queryByRole('switch', { name: /^Include / })).not.toBeInTheDocument();
  },
};

export const EditsAnExistingWorkspace: Story = {
  args: { workspace: workspace() },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    await expect(dialog.getByRole('textbox', { name: /^Workspace name/ })).toHaveValue('Research');
    await expect(dialog.getByText('/mcp/w/research')).toBeVisible();
    await expect(await dialog.findByRole('switch', { name: 'Include filesystem' })).toBeChecked();
    // A member the workspace has switched off is shown as out of it.
    await expect(dialog.getByRole('switch', { name: 'Include docs' })).not.toBeChecked();
    await userEvent.click(dialog.getByRole('button', { name: 'Overrides' }));
    await expect(dialog.getByRole('textbox', { name: ENV_OVERRIDES })).toHaveValue('ROOT_DIR=/srv/research');

    await userEvent.click(dialog.getByRole('switch', { name: 'Include docs' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(UPDATE_ROUTE, {
        name: 'Research',
        enabled: true,
        description: 'Files and docs for the research agent.',
        members: {
          filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' } },
          docs: { enabled: true },
        },
      }),
    );
    await waitFor(() => expect(body.getByText('Saved workspace Research')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const WarnsThatRenamingMovesTheUrl: Story = {
  args: { workspace: workspace() },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), ' Lab');
    await expect(dialog.getByText('/mcp/w/research-lab — renaming moves the URL')).toBeVisible();
  },
};

export const SwitchingAWorkspaceOffHidesHowToConnect: Story = {
  args: { workspace: workspace() },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    const connect = "Point an MCP client at this workspace's aggregate endpoint.";
    await expect(dialog.getByText(connect)).toBeVisible();
    await userEvent.click(dialog.getByRole('switch', { name: 'Enabled' }));
    await expect(dialog.queryByText(connect)).not.toBeInTheDocument();
  },
};

export const ShowsWhyTheServerRefused: Story = {
  parameters: {
    api: {
      ...routes,
      [CREATE_ROUTE]: apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Workspace "backend" already exists'),
    },
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), 'Backend');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(body.getByText('Workspace "backend" already exists')).toBeVisible());
    // The dialog stays open with what was typed.
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await expect(dialog.getByRole('textbox', { name: /^Workspace name/ })).toHaveValue('Backend');
  },
};

export const WhileCreating: Story = {
  parameters: { api: { ...routes, [CREATE_ROUTE]: pending() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), 'Backend');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));
    await expect(await dialog.findByRole('button', { name: /Saving…/ })).toBeDisabled();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};
