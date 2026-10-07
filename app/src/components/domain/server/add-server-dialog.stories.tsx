import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { remoteServer, stdioServer } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { AddServerDialog } from './add-server-dialog.tsx';

const ADD_ROUTE = 'POST /api/servers';
const UPDATE_STDIO_ROUTE = 'PATCH /api/servers/filesystem';
const UPDATE_REMOTE_ROUTE = 'PATCH /api/servers/docs';
const PASTED_CONFIG = JSON.stringify({
  mcpServers: {
    thinking: { command: 'npx', args: ['-y', 'thinking-mcp'], env: { DEPTH: '3' } },
    other: { command: 'node', args: [] },
  },
});

const meta = {
  component: AddServerDialog,
  args: { open: true, onOpenChange: fn() },
  parameters: { api: { [ADD_ROUTE]: stdioServer({ name: 'echo' }) } },
} satisfies Meta<typeof AddServerDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AddIsOffUntilANameAndACommandAreGiven: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await expect(dialog.getByRole('tab', { name: 'Command (stdio)' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeDisabled();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'echo');
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeDisabled();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Command' }), 'npx');
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeEnabled();
    await expect(dialog.getByText('Route segment for this server: /mcp/echo')).toBeVisible();
  },
};

export const AddsACommandServer: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'echo');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Command' }), 'npx');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Arguments (one per line)' }), '-y{Enter}echo-mcp');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Working directory (optional)' }), '/srv/echo');
    await userEvent.click(dialog.getByRole('button', { name: 'Add variable' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Environment variables name' }), 'API_KEY');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Value for API_KEY' }), 'abc123');
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(ADD_ROUTE, {
        name: 'echo',
        source: { type: 'remote' },
        transport: { type: 'stdio', command: 'npx', args: ['-y', 'echo-mcp'], cwd: '/srv/echo' },
        env: { API_KEY: 'abc123' },
        enabled: true,
      }),
    );
    await waitFor(() => expect(body.getByText('Added echo')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const AddsAnHttpServer: Story = {
  parameters: { api: { [ADD_ROUTE]: remoteServer({ name: 'notes' }) } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'notes');
    await userEvent.click(dialog.getByRole('tab', { name: 'HTTP (streamable)' }));
    await userEvent.type(await dialog.findByRole('textbox', { name: 'Server URL' }), 'https://notes.example.test/mcp');
    await userEvent.click(dialog.getByRole('button', { name: 'Add header' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Headers name' }), 'Authorization');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Value for Authorization' }), 'Bearer abc');
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(ADD_ROUTE, {
        name: 'notes',
        source: { type: 'remote' },
        transport: {
          type: 'streamable-http',
          url: 'https://notes.example.test/mcp',
          headers: { Authorization: 'Bearer abc' },
        },
        env: {},
        enabled: true,
      }),
    );
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

export const RejectsAUrlThatIsNotOne: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'notes');
    await userEvent.click(dialog.getByRole('tab', { name: 'HTTP (streamable)' }));
    const url = await dialog.findByRole('textbox', { name: 'Server URL' });
    await userEvent.type(url, 'not a url');
    await expect(await dialog.findByText('Enter a valid URL')).toBeVisible();
    await expect(url).toBeInvalid();
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeDisabled();
  },
};

export const RejectsANameThatCannotBeARoute: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'Bad Name');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Command' }), 'npx');
    await expect(await dialog.findByText(/lowercase alphanumerics/)).toBeVisible();
    await expect(dialog.getByText('Route segment for this server: /mcp/…')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeDisabled();
  },
};

export const FillsTheFieldsFromAPastedConfig: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await expect(dialog.getByRole('button', { name: 'Apply config' })).toBeDisabled();
    await userEvent.click(dialog.getByRole('textbox', { name: 'Paste a config' }));
    await userEvent.paste(PASTED_CONFIG);
    await userEvent.click(dialog.getByRole('button', { name: 'Apply config' }));

    await expect(dialog.getByRole('textbox', { name: 'Local name' })).toHaveValue('thinking');
    await expect(dialog.getByRole('textbox', { name: 'Command' })).toHaveValue('npx');
    await expect(dialog.getByRole('textbox', { name: 'Arguments (one per line)' })).toHaveValue('-y\nthinking-mcp');
    await expect(dialog.getByRole('textbox', { name: 'Value for DEPTH' })).toHaveValue('3');
    // Only the first server of the paste is used, and the toast says so.
    await waitFor(() => expect(body.getByText(/Ignored 1 other server in the paste/)).toBeVisible());
    await expect(dialog.getByRole('button', { name: 'Add server' })).toBeEnabled();
  },
};

export const SaysWhyAPastedConfigCannotBeRead: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Paste a config' }), 'not json');
    await userEvent.click(dialog.getByRole('button', { name: 'Apply config' }));
    await waitFor(() => expect(body.getByText(/^Could not parse config:/)).toBeVisible());
    await expect(dialog.getByRole('textbox', { name: 'Command' })).toHaveValue('');
  },
};

export const ShowsWhyTheServerRefused: Story = {
  parameters: {
    api: { [ADD_ROUTE]: apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Server "echo" already exists') },
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'echo');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Command' }), 'npx');
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));
    await waitFor(() => expect(body.getByText('Server "echo" already exists')).toBeVisible());
    // The dialog stays open with what was typed.
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await expect(dialog.getByRole('textbox', { name: 'Local name' })).toHaveValue('echo');
  },
};

export const WhileAdding: Story = {
  parameters: { api: { [ADD_ROUTE]: pending() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add a server' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Local name' }), 'echo');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Command' }), 'npx');
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));
    await expect(await dialog.findByRole('button', { name: /Adding…/ })).toBeDisabled();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

export const EditsACommandServer: Story = {
  args: { server: stdioServer() },
  parameters: { api: { [UPDATE_STDIO_ROUTE]: stdioServer() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit filesystem' }));
    // The name is the route, so it cannot change; there is nothing to paste into an existing server.
    await expect(dialog.getByRole('textbox', { name: 'Local name' })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Local name' })).toHaveValue('filesystem');
    await expect(dialog.queryByRole('textbox', { name: 'Paste a config' })).not.toBeInTheDocument();
    await expect(dialog.getByRole('textbox', { name: 'Arguments (one per line)' })).toHaveValue('index.js\n/tmp');
    await expect(dialog.getByRole('textbox', { name: 'Value for ROOT_DIR' })).toHaveValue('/tmp');

    const command = dialog.getByRole('textbox', { name: 'Command' });
    await expect(command).toHaveValue('node');
    await userEvent.clear(command);
    await userEvent.type(command, 'bun');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(UPDATE_STDIO_ROUTE, {
        transport: { type: 'stdio', command: 'bun', args: ['index.js', '/tmp'] },
        env: { ROOT_DIR: '/tmp' },
      }),
    );
    await waitFor(() => expect(body.getByText('Updated filesystem')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const EditsAnHttpServer: Story = {
  args: { server: remoteServer() },
  parameters: { api: { [UPDATE_REMOTE_ROUTE]: remoteServer() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit docs' }));
    await expect(dialog.getByRole('tab', { name: 'HTTP (streamable)' })).toHaveAttribute('aria-selected', 'true');
    const url = dialog.getByRole('textbox', { name: 'Server URL' });
    await expect(url).toHaveValue('https://docs.example.test/mcp');
    await userEvent.type(url, '/v2');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    // A proxied server has no child process, so no env is sent.
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(UPDATE_REMOTE_ROUTE, {
        transport: { type: 'streamable-http', url: 'https://docs.example.test/mcp/v2', headers: {} },
      }),
    );
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

export const ShowsWhyTheEditWasRefused: Story = {
  args: { server: stdioServer() },
  parameters: {
    api: {
      [UPDATE_STDIO_ROUTE]: apiError(
        HttpStatus.BadRequest,
        ErrorCode.BadUserInput,
        'Invalid transport',
        'cwd must be absolute',
      ),
    },
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Edit filesystem' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Working directory (optional)' }), 'relative');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(body.getByText('Invalid transport')).toBeVisible());
    await expect(body.getByText('cwd must be absolute')).toBeVisible();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};
