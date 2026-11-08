import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, discoveredServer, discovery } from '@/storybook/fixtures';
import { apiRequest } from '@/storybook/mock-api';
import { DismissedServersCard } from './dismissed-servers-card.tsx';

const DISMISS_ROUTE = 'POST /api/discovery/dismissed';
const skills = discoveredServer({ state: 'dismissed' });
const notes = discoveredServer({
  key: 'MCP Notes on desk/io.github.cubicecho.mcp-notes.desk/notes',
  cardName: 'io.github.cubicecho.mcp-notes.desk/notes',
  title: 'Notes',
  host: 'MCP Notes on desk',
  url: 'http://192.168.1.30:3100/mcp',
  suggestedName: 'notes',
  state: 'dismissed',
});

const meta = {
  component: DismissedServersCard,
  args: { servers: [skills, notes] },
  parameters: {
    a11y: { test: 'error' },
    api: { ...appRoutes(), [DISMISS_ROUTE]: discovery({ servers: [notes] }) },
  },
} satisfies Meta<typeof DismissedServersCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEachDismissedServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Dismissed servers' })).toBeVisible();
    await expect(canvas.getByText('MCP Skills on nas')).toBeVisible();
    await expect(canvas.getByText('http://192.168.1.30:3100/mcp')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Offer again: Notes' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WhenNoneAreDismissed: Story = {
  args: { servers: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No dismissed servers.')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /again/ })).toBeNull();
  },
};

export const OffersADismissedServerAgain: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Offer again: MCP Skills on nas' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(DISMISS_ROUTE, { key: skills.key, dismissed: false }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByText('MCP Skills on nas is offered again')).toBeVisible());
  },
};
