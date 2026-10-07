import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { remoteServer, stdioServer } from '@/storybook/fixtures';
import { apiRequest } from '@/storybook/mock-api';
import { ServerList } from './list.tsx';

const meta = {
  component: ServerList,
  args: { servers: [stdioServer(), remoteServer()] },
} satisfies Meta<typeof ServerList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'docs' })).toBeVisible();
  },
};

export const RestartsFromTheRowMenu: Story = {
  parameters: { api: { 'POST /api/servers/filesystem/restart': stdioServer() } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Actions for filesystem' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Restart' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST /api/servers/filesystem/restart', undefined));
    // The menu hides the rest of the page from assistive tech until it has finished closing.
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument());
  },
};

export const DeletesOnlyAfterConfirming: Story = {
  parameters: { api: { 'DELETE /api/servers/docs': null } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Actions for docs' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'Delete' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('DELETE /api/servers/docs', undefined);
    const dialog = within(await body.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('DELETE /api/servers/docs', undefined));
  },
};
