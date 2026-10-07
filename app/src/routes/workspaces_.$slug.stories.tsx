import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, workspace } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const WORKSPACE_ROUTE = '/api/workspaces/research';

const meta = {
  title: 'routes/workspaces-slug',
  parameters: { route: '/workspaces/research', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Research' })).toBeVisible();
    await expect(canvas.getByText('Files and docs for the research agent.')).toBeVisible();
    await expect(await canvas.findByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(canvas.getByText(/\/mcp\/w\/research$/)).toBeVisible();
    await expect(canvas.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    // Each member with its own switch: one on, one off.
    await expect(canvas.getByRole('switch', { name: 'Enable filesystem in workspace' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'Enable docs in workspace' })).not.toBeChecked();
    await expect(canvas.getByRole('tab', { name: 'Tools', selected: true })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Workspaces', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), [`GET ${WORKSPACE_ROUTE}`]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status', { name: 'Loading' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    // The way back does not wait for the answer.
    await expect(canvas.getByRole('link', { name: 'Back to workspaces' })).toBeVisible();
  },
};

export const WhenTheWorkspaceDoesNotExist: Story = {
  parameters: {
    route: '/workspaces/missing',
    api: {
      ...appRoutes(),
      'GET /api/workspaces/missing': apiError(HttpStatus.NotFound, ErrorCode.NotFound, 'Workspace "missing" not found'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load workspace')).toBeVisible();
    await expect(alert.getByText('Workspace "missing" not found')).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'missing' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
  },
};

export const WithNoMembers: Story = {
  // A function, because Storybook merges a story's parameters into the meta's key by key: a plain
  // object here would be merged with the two members of the default workspace and not replace them.
  parameters: { api: { ...appRoutes(), [`GET ${WORKSPACE_ROUTE}`]: () => workspace({ members: {} }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Servers' })).toBeVisible();
    await expect(canvas.getByText('This workspace has no servers yet. Edit it to add some.')).toBeVisible();
    await expect(canvas.queryByRole('switch', { name: /in workspace$/ })).not.toBeInTheDocument();
  },
};

export const ShowsAMemberThatIsNoLongerInstalled: Story = {
  parameters: {
    // A function, so the members replace the default workspace's and are not merged into them.
    api: { ...appRoutes(), [`GET ${WORKSPACE_ROUTE}`]: () => workspace({ members: { gone: { enabled: true } } }) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('not installed')).toBeVisible();
    await expect(canvas.getByRole('switch', { name: 'Enable gone in workspace' })).toBeChecked();
    await expect(canvas.queryByRole('switch', { name: 'Enable filesystem in workspace' })).not.toBeInTheDocument();
  },
};

export const DisablesTheWorkspace: Story = {
  parameters: { api: { ...appRoutes(), [`PATCH ${WORKSPACE_ROUTE}`]: workspace({ enabled: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('switch', { name: 'Enabled' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`PATCH ${WORKSPACE_ROUTE}`, { enabled: false }));
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('Disabled Research')).toBeVisible());
  },
};

export const ShowsADisabledWorkspace: Story = {
  parameters: { api: { ...appRoutes(), [`GET ${WORKSPACE_ROUTE}`]: workspace({ enabled: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('switch', { name: 'Enabled' })).not.toBeChecked();
    await expect(canvas.getByText('Disabled')).toBeVisible();
  },
};

export const SwitchesAMemberOnKeepingTheOthers: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`PATCH ${WORKSPACE_ROUTE}`]: workspace({
        members: { ...workspace().members, docs: { enabled: true } },
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('switch', { name: 'Enable docs in workspace' }));

    // The whole map is sent again, so the other member's override survives.
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(`PATCH ${WORKSPACE_ROUTE}`, {
        members: {
          filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' } },
          docs: { enabled: true },
        },
      }),
    );
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Enabled docs in Research')).toBeVisible(),
    );
  },
};

export const OpensTheEditDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit' }));

    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Edit Research' }),
    );
    await expect(dialog.getByRole('textbox', { name: /Workspace name/ })).toHaveValue('Research');
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible();
  },
};

export const FollowsARenameToTheNewUrl: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [`PATCH ${WORKSPACE_ROUTE}`]: workspace({ name: 'Lab', slug: 'lab', path: '/mcp/w/lab' }),
      'GET /api/workspaces/lab': workspace({ name: 'Lab', slug: 'lab', path: '/mcp/w/lab' }),
      'GET /api/workspaces/lab/tools': { tools: [] },
      'GET /api/workspaces/lab/resources': { resources: [], resourceTemplates: [] },
      'GET /api/workspaces/lab/prompts': { prompts: [] },
      'GET /api/workspaces/lab/activity': { entries: [] },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit' }));

    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    await dialog.findByRole('switch', { name: 'Include filesystem' });
    const name = dialog.getByRole('textbox', { name: /Workspace name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Lab');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    // The old slug no longer exists, so the page moves to the new one instead of staying behind.
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Lab' })).toBeVisible());
    await expect(canvas.getByText(/\/mcp\/w\/lab/)).toBeVisible();
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const DeletesOnlyAfterConfirming: Story = {
  parameters: { api: { ...appRoutes(), [`DELETE ${WORKSPACE_ROUTE}`]: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete Research' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Delete workspace Research?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith(`DELETE ${WORKSPACE_ROUTE}`, undefined);

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(`DELETE ${WORKSPACE_ROUTE}`, undefined));
    await waitFor(() => expect(body.getByText('Deleted workspace Research')).toBeVisible());
    // A deleted workspace has no page: the app goes back to the list.
    await expect(await canvas.findByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const GoesBackToTheWorkspaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('link', { name: 'Back to workspaces' }));
    await expect(await canvas.findByRole('heading', { name: 'Workspaces' })).toBeVisible();
  },
};
