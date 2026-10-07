import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { toolCallResult, toolsResponse } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { ToolsCard } from './tools-card.tsx';

const LIST = 'GET /api/servers/filesystem/tools';
const CALL = 'POST /api/servers/filesystem/tools/call';
/** The first load and the one retry. */
const LOADS_AFTER_RETRY = 2;

const meta = {
  component: ToolsCard,
  args: { scope: { kind: 'server', name: 'filesystem' } },
  parameters: { api: { [LIST]: toolsResponse(), [CALL]: toolCallResult() } },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToolsCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Opens a tool's row and returns its arguments box. */
async function openTool(canvasElement: HTMLElement, name: RegExp): Promise<HTMLElement> {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name }));
  return canvas.getByRole('textbox', { name: /Arguments/ });
}

/** Replaces what the arguments box holds. `{` and `[` are typed doubled, as user-event reads them as keys. */
async function typeArguments(box: HTMLElement, text: string): Promise<void> {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

export const ListsTheToolsOfAServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /read_file/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /list_files/ })).toBeVisible();
    await expect(canvas.getByText('Read one file.')).toBeVisible();
    await expect(canvas.getByText(/Tools reported by the downstream server/)).toBeVisible();
  },
};

export const ListsTheToolsOfAWorkspace: Story = {
  args: { scope: { kind: 'workspace', slug: 'research' } },
  parameters: {
    api: {
      'GET /api/workspaces/research/tools': toolsResponse({
        tools: [{ name: 'filesystem__read_file', description: 'Read one file.' }],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /filesystem__read_file/ })).toBeVisible();
    await expect(canvas.getByText(/Tools exposed by the workspace aggregate/)).toBeVisible();
  },
};

export const PrefillsArgumentsFromTheSchema: Story = {
  play: async ({ canvasElement }) => {
    const box = await openTool(canvasElement, /read_file/);
    await expect(box).toHaveValue('{\n  "path": ""\n}');
  },
};

export const RunsAToolAndShowsItsResult: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openTool(canvasElement, /read_file/);
    await typeArguments(box, '{{"path":"/tmp/notes.txt"}');
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(CALL, { name: 'read_file', arguments: { path: '/tmp/notes.txt' } }),
    );
    await expect(await canvas.findByText('Result')).toBeVisible();
    await expect(canvas.getByText(/hello from notes.txt/)).toBeVisible();
  },
};

export const ShowsProgressWhileAToolRuns: Story = {
  parameters: { api: { [LIST]: toolsResponse(), [CALL]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openTool(canvasElement, /list_files/);
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    await expect(await canvas.findByRole('button', { name: /Running/ })).toBeDisabled();
    await expect(canvas.queryByText('Result')).not.toBeInTheDocument();
  },
};

export const MarksAResultTheToolCalledAnError: Story = {
  parameters: {
    api: {
      [LIST]: toolsResponse(),
      [CALL]: toolCallResult({ isError: true, content: [{ type: 'text', text: 'ENOENT: no such file' }] }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openTool(canvasElement, /read_file/);
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    await expect(await canvas.findByText('Tool returned an error')).toBeVisible();
    await expect(canvas.getByText(/ENOENT: no such file/)).toBeVisible();
  },
};

export const RefusesArgumentsThatAreNotAnObject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openTool(canvasElement, /read_file/);
    await typeArguments(box, '[[1]');
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    await expect(await canvas.findByText('Arguments must be a JSON object')).toBeVisible();
    await expect(apiRequest).not.toHaveBeenCalledWith(CALL, expect.anything());
  },
};

export const RefusesArgumentsThatAreNotJson: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openTool(canvasElement, /read_file/);
    await typeArguments(box, 'path=/tmp');
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    await expect(await canvas.findByText(/Not valid JSON/)).toBeVisible();
    await expect(apiRequest).not.toHaveBeenCalledWith(CALL, expect.anything());
  },
};

export const SaysWhyACallFailed: Story = {
  parameters: {
    api: {
      [LIST]: toolsResponse(),
      [CALL]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'Tool call failed', 'The server exited.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openTool(canvasElement, /list_files/);
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Tool call failed')).toBeVisible());
    await expect(body.getByText('The server exited.')).toBeVisible();
    await expect(canvas.queryByText('Result')).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { [LIST]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Tools' })).toBeVisible();
    await expect(canvas.queryByText('No tools reported.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

export const WithNoTools: Story = {
  parameters: { api: { [LIST]: toolsResponse({ tools: [] }) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No tools reported.')).toBeVisible();
  },
};

export const FailedToLoad: Story = {
  parameters: { api: { [LIST]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'spawn node ENOENT') } },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load tools')).toBeVisible();
    await expect(alert.getByText('spawn node ENOENT')).toBeVisible();
    await userEvent.click(alert.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiRequest.mock.calls.filter(([key]) => key === LIST)).toHaveLength(LOADS_AFTER_RETRY));
  },
};
