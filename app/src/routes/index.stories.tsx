import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { LanServerState } from '@/__generated__/graphql';
import { appRoutes, discoveredServer, lanServersAnswer, serversAnswer } from '@/storybook/fixtures';
import { pending } from '@/storybook/mock-api';

const meta = {
  title: 'routes/index',
  parameters: { route: '/', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsTheInstalledServers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Servers', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WithNoServers: Story = {
  parameters: { api: { ...appRoutes(), Servers: serversAnswer([]) } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/no servers/i)).toBeVisible();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), Servers: pending() } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('status')).toBeVisible();
  },
};

export const OffersServersFoundOnTheNetwork: Story = {
  parameters: { api: { ...appRoutes(), LanServers: lanServersAnswer() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Found on your network' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Add MCP Skills on nas' })).toBeVisible();
    await expect(await canvas.findByRole('link', { name: 'Filesystem' })).toBeVisible();
  },
};

export const OffersNothingOnceAFoundServerIsAdded: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      LanServers: lanServersAnswer({
        servers: [discoveredServer({ state: LanServerState.Added, serverName: 'skills' })],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Found on your network' })).not.toBeInTheDocument();
  },
};
