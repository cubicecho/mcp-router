import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { remoteServer, stdioServer, workspace } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { MembersCard } from './members-card.tsx';

const SERVERS_ROUTE = 'GET /api/servers';
const UPDATE_ROUTE = 'PATCH /api/workspaces/research';
const FILESYSTEM_SWITCH = 'Enable filesystem in workspace';
const DOCS_SWITCH = 'Enable docs in workspace';

const meta = {
  component: MembersCard,
  args: { workspace: workspace() },
  parameters: {
    api: {
      [SERVERS_ROUTE]: [stdioServer(), remoteServer()],
      'GET /api/workspaces': [workspace()],
      'GET /api/workspaces/research': workspace(),
      [UPDATE_ROUTE]: workspace(),
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MembersCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryMemberWithItsState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Servers' })).toBeVisible();
    await expect(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: DOCS_SWITCH })).not.toBeChecked();
    // Once the installed servers arrive, each row shows its display name, transport and state.
    await expect(await canvas.findByText('Filesystem')).toBeVisible();
    await expect(canvas.getByText('stdio')).toBeVisible();
    await expect(canvas.getByText('running')).toBeVisible();
    await expect(canvas.getByText('http')).toBeVisible();
    await expect(canvas.getByText('stopped')).toBeVisible();
    // The filesystem member overrides the server's env for this workspace.
    await expect(canvas.getByText('env')).toBeVisible();
  },
};

export const DisablesAMemberAndKeepsItsOverrides: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(UPDATE_ROUTE, {
        members: {
          filesystem: { enabled: false, env: { ROOT_DIR: '/srv/research' } },
          docs: { enabled: false },
        },
      }),
    );
    await waitFor(() => expect(body.getByText('Disabled filesystem in Research')).toBeVisible());
  },
};

export const EnablesAMember: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('switch', { name: DOCS_SWITCH }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(UPDATE_ROUTE, {
        members: {
          filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' } },
          docs: { enabled: true },
        },
      }),
    );
    await waitFor(() => expect(body.getByText('Enabled docs in Research')).toBeVisible());
  },
};

export const NamesEveryKindOfOverride: Story = {
  args: {
    workspace: workspace({
      members: {
        filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' }, args: ['index.js', '/srv/research'] },
        docs: {
          enabled: true,
          headers: { Authorization: 'Bearer abc' },
          url: 'https://docs.example.test/mcp/research',
        },
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('env')).toBeVisible();
    await expect(canvas.getByText('args')).toBeVisible();
    await expect(canvas.getByText('headers')).toBeVisible();
    await expect(canvas.getByText('url')).toBeVisible();
  },
};

export const FlagsAMemberWhoseServerIsGone: Story = {
  parameters: { api: { [SERVERS_ROUTE]: [stdioServer()] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('Filesystem')).toBeVisible();
    await expect(canvas.getByText('not installed')).toBeVisible();
    // It can still be switched, so a stale member can be turned off.
    await expect(canvas.getByRole('switch', { name: DOCS_SWITCH })).toBeEnabled();
  },
};

export const WithNoMembers: Story = {
  args: { workspace: workspace({ members: {} }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('This workspace has no servers yet. Edit it to add some.')).toBeVisible();
    await expect(canvas.queryByRole('switch')).not.toBeInTheDocument();
  },
};

export const WhileTheInstalledServersLoad: Story = {
  parameters: { api: { [SERVERS_ROUTE]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The members are the workspace's own, so they are listed by name before the servers arrive.
    await expect(canvas.getByText('filesystem')).toBeVisible();
    await expect(canvas.getByText('docs')).toBeVisible();
    await expect(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH })).toBeChecked();
  },
};

export const LocksTheSwitchesWhileSaving: Story = {
  parameters: { api: { [SERVERS_ROUTE]: [stdioServer(), remoteServer()], [UPDATE_ROUTE]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH }));
    await waitFor(() => expect(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH })).toBeDisabled());
    await expect(canvas.getByRole('switch', { name: DOCS_SWITCH })).toBeDisabled();
  },
};

export const ShowsWhyTheChangeWasRefused: Story = {
  parameters: {
    api: {
      [SERVERS_ROUTE]: [stdioServer(), remoteServer()],
      [UPDATE_ROUTE]: apiError(HttpStatus.NotFound, ErrorCode.NotFound, 'Workspace "research" not found'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH }));
    await waitFor(() => expect(body.getByText('Workspace "research" not found')).toBeVisible());
    // The switch still shows what the server has.
    await expect(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH })).toBeChecked();
    await waitFor(() => expect(canvas.getByRole('switch', { name: FILESYSTEM_SWITCH })).toBeEnabled());
  },
};
