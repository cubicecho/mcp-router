import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { resourceReadResult, resourcesResponse } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { ResourcesCard } from './resources-card.tsx';

const LIST = 'GET /api/servers/filesystem/resources';
const READ = 'POST /api/servers/filesystem/resources/read';

const meta = {
  component: ResourcesCard,
  args: { scope: { kind: 'server', name: 'filesystem' } },
  parameters: { api: { [LIST]: resourcesResponse(), [READ]: resourceReadResult() } },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResourcesCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsResourcesAndTemplates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resource = await canvas.findByRole('button', { name: /notes\.txt/ });
    await expect(resource).toBeVisible();
    await expect(canvas.getByText('file:///tmp/notes.txt')).toBeVisible();
    await expect(canvas.getByText('text/plain')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /any file/ })).toBeVisible();
    await expect(canvas.getByText('template')).toBeVisible();
    await expect(canvas.getByText(/exposed by the downstream server/)).toBeVisible();
  },
};

export const ListsTheResourcesOfAWorkspace: Story = {
  args: { scope: { kind: 'workspace', slug: 'research' } },
  parameters: { api: { 'GET /api/workspaces/research/resources': resourcesResponse({ resourceTemplates: [] }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /notes\.txt/ })).toBeVisible();
    await expect(canvas.getByText(/exposed by the workspace aggregate/)).toBeVisible();
  },
};

export const ReadsAResourceAndShowsItsContents: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /notes\.txt/ }));
    await expect(canvas.getByRole('textbox', { name: 'URI' })).toHaveValue('file:///tmp/notes.txt');
    await userEvent.click(canvas.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(READ, { uri: 'file:///tmp/notes.txt' }));
    await expect(await canvas.findByText('Result')).toBeVisible();
    await expect(canvas.getByText(/hello from notes.txt/)).toBeVisible();
  },
};

export const ReadsATemplateOnceItIsFilledIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /any file/ }));
    const uri = canvas.getByRole('textbox', { name: 'URI' });
    await expect(uri).toHaveValue('file:///tmp/{name}');
    await expect(canvas.getByText('Replace the {placeholders} with concrete values.')).toBeVisible();
    await userEvent.clear(uri);
    await userEvent.type(uri, ' file:///tmp/todo.txt ');
    await userEvent.click(canvas.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(READ, { uri: 'file:///tmp/todo.txt' }));
  },
};

export const RefusesToReadWithoutAUri: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /notes\.txt/ }));
    await userEvent.clear(canvas.getByRole('textbox', { name: 'URI' }));
    await expect(await canvas.findByText('A URI is required')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Read' }));
    await expect(apiRequest).not.toHaveBeenCalledWith(READ, expect.anything());
  },
};

export const SaysWhyAReadFailed: Story = {
  parameters: {
    api: {
      [LIST]: resourcesResponse(),
      [READ]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'Resource read failed', 'No such file.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /notes\.txt/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Read' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Resource read failed')).toBeVisible());
    await expect(body.getByText('No such file.')).toBeVisible();
    await expect(canvas.queryByText('Result')).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { [LIST]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Resources' })).toBeVisible();
    await expect(canvas.queryByText('No resources reported.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

export const WithNoResources: Story = {
  parameters: { api: { [LIST]: resourcesResponse({ resources: [], resourceTemplates: [] }) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No resources reported.')).toBeVisible();
  },
};

export const FailedToLoad: Story = {
  parameters: { api: { [LIST]: apiError(HttpStatus.BadGateway, ErrorCode.UpstreamFailed, 'spawn node ENOENT') } },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load resources')).toBeVisible();
    await expect(alert.getByText('spawn node ENOENT')).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
