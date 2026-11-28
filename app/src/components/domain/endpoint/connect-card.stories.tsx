import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { STORY_SESSION } from '@/storybook/mock-api';
import { ConnectCard } from './connect-card.tsx';

const ENDPOINT = 'http://router.example.test/mcp/filesystem';

const meta = {
  component: ConnectCard,
  args: {
    endpoint: ENDPOINT,
    label: 'filesystem',
    description: 'Point an MCP client directly at filesystem (tools keep their original names).',
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConnectCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AsksForAnApiKey: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Connect a client', level: 2 })).toBeVisible();
    await expect(canvas.getByText(/Point an MCP client directly at filesystem/)).toBeVisible();
    await expect(
      canvas.getByText(
        `claude mcp add --transport http filesystem ${ENDPOINT} --header "Authorization: Bearer <YOUR_API_KEY>"`,
      ),
    ).toBeVisible();
    await expect(
      canvas.getByText('Replace <YOUR_API_KEY> with a key from Settings → API keys. Every client needs one.'),
    ).toBeVisible();
    // The operator's own session is never handed to a client.
    await expect(canvas.queryByText(new RegExp(STORY_SESSION))).not.toBeInTheDocument();
  },
};

export const ShowsASnippetPerClient: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(canvas.getByRole('tab', { name: '.mcp.json' }));
    await expect(canvas.getByRole('tab', { name: '.mcp.json' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByText(/"mcpServers"/)).toBeVisible();

    await userEvent.click(canvas.getByRole('tab', { name: 'OpenCode' }));
    await expect(canvas.getByText(/opencode\.ai\/config\.json/)).toBeVisible();

    await userEvent.click(canvas.getByRole('tab', { name: 'curl' }));
    await expect(canvas.getByText(new RegExp(`curl -X POST ${ENDPOINT}`))).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Copy snippet' })).toBeVisible();
  },
};

export const SitsUnderADialogTitle: Story = {
  args: { level: 3 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'Connect a client', level: 3 })).toBeVisible();
  },
};
