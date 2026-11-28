import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PAGE_DEFAULTS } from '@/lib/defaults';
import {
  DOCS_ID,
  FILESYSTEM_ID,
  RESEARCH_ID,
  remoteServer,
  routerStatus,
  serversAnswer,
  stdioServer,
  workspace,
  workspaceRecord,
} from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { WorkspaceDialog } from './workspace-dialog.tsx';

/** Creating and editing are one operation: an input with an `id` replaces that workspace. */
const SAVE = 'SaveWorkspace';
const ENV_OVERRIDES = 'Env overrides (KEY=VALUE per line)';
const MEMBER_LIMIT = PAGE_DEFAULTS.workspaceMembers;

const BACKEND = workspace({ id: '00000000-0000-4000-8000-0000000000a3', name: 'Backend', slug: 'backend' });

const routes = {
  Servers: serversAnswer([stdioServer(), remoteServer()]),
  RouterStatus: { routerStatus: routerStatus() },
  // A function, so a create answers with the new workspace and an edit with the one it replaced.
  [SAVE]: ({ body }: { body: unknown }) => {
    const input = (body as { input?: { id?: string } } | undefined)?.input;
    return { saveWorkspace: workspaceRecord(input?.id === RESEARCH_ID ? workspace() : BACKEND) };
  },
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
      expect(apiRequest).toHaveBeenCalledWith(SAVE, {
        input: {
          name: 'Backend',
          enabled: true,
          description: 'Team servers',
          members: [{ serverId: FILESYSTEM_ID, enabled: true, env: { ROOT_DIR: '/srv/backend' } }],
        },
        memberLimit: MEMBER_LIMIT,
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
      expect(apiRequest).toHaveBeenCalledWith(SAVE, {
        input: {
          name: 'Backend',
          enabled: true,
          description: null,
          members: [{ serverId: DOCS_ID, enabled: true, url: 'https://docs.example.test/mcp/team' }],
        },
        memberLimit: MEMBER_LIMIT,
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
    await expect(apiRequest).not.toHaveBeenCalledWith(SAVE, expect.anything());
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

export const WithNoServersInstalled: Story = {
  parameters: { api: { ...routes, Servers: serversAnswer([]) } },
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
    // A member switched off on the workspace page is still a member, and is marked as off.
    await expect(dialog.getByRole('switch', { name: 'Include docs' })).toBeChecked();
    await expect(dialog.getByText('disabled')).toBeVisible();
    // Both members have overrides to open; filesystem is listed first.
    const [filesystemOverrides] = dialog.getAllByRole('button', { name: 'Overrides' });
    await userEvent.click(filesystemOverrides as HTMLElement);
    await expect(dialog.getByRole('textbox', { name: ENV_OVERRIDES })).toHaveValue('ROOT_DIR=/srv/research');

    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(SAVE, {
        input: {
          id: RESEARCH_ID,
          slug: 'research',
          name: 'Research',
          enabled: true,
          description: 'Files and docs for the research agent.',
          members: [
            { serverId: FILESYSTEM_ID, enabled: true, env: { ROOT_DIR: '/srv/research' } },
            { serverId: DOCS_ID, enabled: false },
          ],
        },
        memberLimit: MEMBER_LIMIT,
      }),
    );
    await waitFor(() => expect(body.getByText('Saved workspace Research')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const ClearsTheDescription: Story = {
  args: { workspace: workspace() },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Research' }));
    await dialog.findByRole('switch', { name: 'Include filesystem' });
    await userEvent.clear(dialog.getByRole('textbox', { name: /^Description/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    // Sent as null rather than left out: saving replaces the workspace, so the old description is cleared.
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(SAVE, {
        input: expect.objectContaining({ id: RESEARCH_ID, description: null }),
        memberLimit: MEMBER_LIMIT,
      }),
    );
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
      [SAVE]: apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Workspace "backend" already exists'),
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
  parameters: { api: { ...routes, [SAVE]: pending() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'New workspace' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /^Workspace name/ }), 'Backend');
    await userEvent.click(dialog.getByRole('button', { name: 'Create workspace' }));
    await expect(await dialog.findByRole('button', { name: /Saving…/ })).toBeDisabled();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};
