import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { promptGetResult, promptsResponse } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { PromptsCard } from './prompts-card.tsx';

const LIST = 'GET /api/servers/filesystem/prompts';
const GET = 'POST /api/servers/filesystem/prompts/get';

const meta = {
  component: PromptsCard,
  args: { scope: { kind: 'server', name: 'filesystem' } },
  parameters: { api: { [LIST]: promptsResponse(), [GET]: promptGetResult() } },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PromptsCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsThePromptsOfAServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /summarise/ })).toBeVisible();
    await expect(canvas.getByText('Summarise a file.')).toBeVisible();
    await expect(canvas.getByText(/Prompt templates exposed by the downstream server/)).toBeVisible();
  },
};

export const ListsThePromptsOfAWorkspace: Story = {
  args: { scope: { kind: 'workspace', slug: 'research' } },
  parameters: {
    api: { 'GET /api/workspaces/research/prompts': promptsResponse({ prompts: [{ name: 'filesystem__summarise' }] }) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /filesystem__summarise/ })).toBeVisible();
    await expect(canvas.getByText(/Prompt templates exposed by the workspace aggregate/)).toBeVisible();
  },
};

export const GetsAPromptWithItsArguments: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /summarise/ }));
    const path = canvas.getByRole('textbox', { name: /path/ });
    await expect(path).toBeRequired();
    await expect(canvas.getByText('The file to summarise.')).toBeVisible();
    await userEvent.type(path, '/tmp/notes.txt');
    await userEvent.click(canvas.getByRole('button', { name: 'Get' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(GET, { name: 'summarise', arguments: { path: '/tmp/notes.txt' } }),
    );
    await expect(await canvas.findByText('Result')).toBeVisible();
    await expect(canvas.getByText(/Summarise \/tmp\/notes.txt in one line/)).toBeVisible();
  },
};

export const RefusesToGetWithoutARequiredArgument: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /summarise/ }));
    const path = canvas.getByRole('textbox', { name: /path/ });
    await userEvent.type(path, 'x');
    await userEvent.clear(path);
    await expect(await canvas.findByText('path is required')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Get' }));
    await expect(apiRequest).not.toHaveBeenCalledWith(GET, expect.anything());
  },
};

export const LeavesOutArgumentsLeftBlank: Story = {
  parameters: {
    api: {
      [LIST]: promptsResponse({
        prompts: [{ name: 'greet', arguments: [{ name: 'name' }, { name: 'tone', description: 'Formal or casual.' }] }],
      }),
      [GET]: promptGetResult(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /greet/ }));
    await userEvent.type(canvas.getByRole('textbox', { name: /tone/ }), 'casual');
    await userEvent.click(canvas.getByRole('button', { name: 'Get' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(GET, { name: 'greet', arguments: { tone: 'casual' } }));
  },
};

export const GetsAPromptThatTakesNoArguments: Story = {
  parameters: { api: { [LIST]: promptsResponse({ prompts: [{ name: 'standup' }] }), [GET]: promptGetResult() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /standup/ }));
    await expect(canvas.getByText('This prompt takes no arguments.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Get' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(GET, { name: 'standup', arguments: {} }));
    await expect(await canvas.findByText('Result')).toBeVisible();
  },
};

export const SaysWhyAGetFailed: Story = {
  parameters: {
    api: {
      [LIST]: promptsResponse({ prompts: [{ name: 'standup' }] }),
      [GET]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'Prompt get failed', 'Unknown prompt.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /standup/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Get' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Prompt get failed')).toBeVisible());
    await expect(body.getByText('Unknown prompt.')).toBeVisible();
    await expect(canvas.queryByText('Result')).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { [LIST]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Prompts' })).toBeVisible();
    await expect(canvas.queryByText('No prompts reported.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

export const WithNoPrompts: Story = {
  parameters: { api: { [LIST]: promptsResponse({ prompts: [] }) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No prompts reported.')).toBeVisible();
  },
};

export const FailedToLoad: Story = {
  parameters: { api: { [LIST]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'spawn node ENOENT') } },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load prompts')).toBeVisible();
    await expect(alert.getByText('spawn node ENOENT')).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
