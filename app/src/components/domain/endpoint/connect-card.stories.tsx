import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { clearToken, setToken } from '@/lib/auth';
import { routerStatus } from '@/storybook/fixtures';
import { pending } from '@/storybook/mock-api';
import { ConnectCard } from './connect-card.tsx';

const STATUS = 'GET /api/status';
const ENDPOINT = 'http://router.example.test/mcp/filesystem';
const TOKEN = 'story-token-123';

/** Signs the story in before it renders, as a browser that already holds the token. */
function withStoredToken(): () => void {
  setToken(TOKEN);
  return clearToken;
}

const meta = {
  component: ConnectCard,
  args: {
    endpoint: ENDPOINT,
    label: 'filesystem',
    description: 'Point an MCP client directly at filesystem (tools keep their original names).',
  },
  parameters: { api: { [STATUS]: routerStatus({ authEnabled: true }) } },
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

export const WithAuthOffLeavesOutTheHeader: Story = {
  parameters: { api: { [STATUS]: routerStatus({ authEnabled: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Connect a client', level: 2 })).toBeVisible();
    await expect(canvas.getByText(/Point an MCP client directly at filesystem/)).toBeVisible();
    await expect(await canvas.findByText(`claude mcp add --transport http filesystem ${ENDPOINT}`)).toBeVisible();
    await expect(canvas.queryByText(/treat them as secrets/)).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Reveal token' })).not.toBeInTheDocument();
  },
};

export const WithoutAStoredTokenShowsAPlaceholder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/--header "Authorization: Bearer <YOUR_TOKEN>"/)).toBeVisible();
    await expect(canvas.getByText(/include your bearer token placeholder/)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Reveal token' })).not.toBeInTheDocument();
  },
};

export const AssumesAuthUntilTheRouterAnswers: Story = {
  parameters: { api: { [STATUS]: pending() } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Authorization: Bearer <YOUR_TOKEN>/)).toBeVisible();
  },
};

export const MasksTheTokenUntilRevealed: Story = {
  beforeEach: withStoredToken,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Authorization: Bearer ••••••••••••/)).toBeVisible();
    await expect(canvas.queryByText(new RegExp(TOKEN))).not.toBeInTheDocument();
    await expect(canvas.getByText(/include your bearer token — treat them as secrets/)).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Reveal token' }));
    await expect(canvas.getByText(new RegExp(`Authorization: Bearer ${TOKEN}`))).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Hide token' }));
    await expect(canvas.queryByText(new RegExp(TOKEN))).not.toBeInTheDocument();
  },
};

export const ShowsASnippetPerClient: Story = {
  parameters: { api: { [STATUS]: routerStatus({ authEnabled: false }) } },
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
