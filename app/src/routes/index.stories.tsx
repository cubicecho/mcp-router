import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { appRoutes } from '@/storybook/fixtures';
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
  parameters: { api: { ...appRoutes(), 'GET /api/servers': [] } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/no servers/i)).toBeVisible();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/servers': pending() } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('status')).toBeVisible();
  },
};
