import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, discoveredServer, discovery } from '@/storybook/fixtures';
import { apiRequest } from '@/storybook/mock-api';
import { FoundServersCard } from './found-servers-card.tsx';

const DISMISS_ROUTE = 'POST /api/discovery/dismissed';
const skills = discoveredServer();
const notes = discoveredServer({
  key: 'MCP Notes on desk/io.github.cubicecho.mcp-notes.desk/notes',
  cardName: 'io.github.cubicecho.mcp-notes.desk/notes',
  title: 'Notes',
  host: 'MCP Notes on desk',
  url: 'http://192.168.1.30:3100/mcp',
  requiredHeaders: [],
  suggestedName: 'notes',
});

const meta = {
  component: FoundServersCard,
  args: { servers: [skills, notes] },
  parameters: {
    a11y: { test: 'error' },
    api: { ...appRoutes(), [DISMISS_ROUTE]: discovery({ servers: [{ ...skills, state: 'dismissed' }, notes] }) },
  },
} satisfies Meta<typeof FoundServersCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OffersEachFoundServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Found on your network' })).toBeVisible();
    await expect(canvas.getByText('MCP Skills on nas')).toBeVisible();
    await expect(canvas.getByText('Notes')).toBeVisible();
    // Only the one that asks for a token says so.
    await expect(canvas.getAllByText('Needs a token')).toHaveLength(1);
    await expect(canvas.getByRole('button', { name: 'Add Notes' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const OpensTheAddDialog: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add MCP Skills on nas' }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' })).toBeVisible();
  },
};

export const DismissesAFoundServer: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Dismiss MCP Skills on nas' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(DISMISS_ROUTE, { key: skills.key, dismissed: true }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('Dismissed MCP Skills on nas')).toBeVisible());
  },
};
