import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, workspace } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const STAGING = workspace({
  name: 'Staging',
  slug: 'staging',
  path: '/mcp/w/staging',
  description: undefined,
  members: { filesystem: { enabled: true } },
});

const meta = {
  title: 'routes/workspaces',
  parameters: { route: '/workspaces', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsTheWorkspaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(await canvas.findByRole('link', { name: 'Research' })).toBeVisible();
    await expect(canvas.getByText('/mcp/w/research')).toBeVisible();
    // Only the member that is switched on counts.
    await expect(canvas.getByRole('cell', { name: '1 server' })).toBeVisible();
    await expect(canvas.getByRole('cell', { name: 'Enabled' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Workspaces', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/workspaces': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status')).toBeVisible();
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
  },
};

export const WithNoWorkspaces: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/workspaces': [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('No workspaces yet')).toBeVisible();
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
    // The empty page invites the first one, beside the button in the header.
    const INVITATIONS = 2;
    await expect(canvas.getAllByRole('button', { name: 'New workspace' })).toHaveLength(INVITATIONS);
  },
};

export const WhenLoadingFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'GET /api/workspaces': apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'workspaces are unreadable'),
    },
  },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load workspaces')).toBeVisible();
    await expect(alert.getByText('workspaces are unreadable')).toBeVisible();
  },
};

export const OpensAWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('link', { name: 'Research' }));
    await expect(await canvas.findByRole('heading', { name: 'Research' })).toBeVisible();
    await expect(await canvas.findByRole('link', { name: 'Back to workspaces' })).toBeVisible();
  },
};

export const CreatesAWorkspace: Story = {
  parameters: { api: { ...appRoutes(), 'POST /api/workspaces': STAGING } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(await canvas.findByRole('link', { name: 'Research' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'New workspace' }));

    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Workspace name/ }), 'Staging');
    // The URL follows the name.
    await expect(dialog.getByText('/mcp/w/staging')).toBeVisible();
    await userEvent.click(await dialog.findByRole('switch', { name: 'Include filesystem' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('POST /api/workspaces', {
        name: 'Staging',
        enabled: true,
        members: { filesystem: { enabled: true } },
      }),
    );
    await waitFor(() => expect(body.getByText('Created workspace Staging')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const EditsAWorkspaceFromItsRow: Story = {
  parameters: {
    api: { ...appRoutes(), 'PATCH /api/workspaces/research': workspace({ description: 'Read-only research.' }) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit Research' }));

    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    const description = dialog.getByRole('textbox', { name: 'Description (optional)' });
    await userEvent.clear(description);
    await userEvent.type(description, 'Read-only research.');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('PATCH /api/workspaces/research', {
        name: 'Research',
        enabled: true,
        description: 'Read-only research.',
        // The member that is switched off stays a member, still off; the other keeps its override.
        members: { filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' } }, docs: { enabled: false } },
      }),
    );
    await waitFor(() => expect(body.getByText('Saved workspace Research')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

export const DeletesOnlyAfterConfirming: Story = {
  parameters: { api: { ...appRoutes(), 'DELETE /api/workspaces/research': null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete Research' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Delete workspace Research?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('DELETE /api/workspaces/research', undefined);

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('DELETE /api/workspaces/research', undefined));
    await waitFor(() => expect(body.getByText('Deleted workspace Research')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const WhenDeletingFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'DELETE /api/workspaces/research': apiError(
        HttpStatus.InternalServerError,
        ErrorCode.Internal,
        'Could not remove it',
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete Research' }));
    await userEvent.click(within(await body.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(body.getByText('Could not remove it')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
    await expect(canvas.getByRole('link', { name: 'Research' })).toBeVisible();
  },
};
