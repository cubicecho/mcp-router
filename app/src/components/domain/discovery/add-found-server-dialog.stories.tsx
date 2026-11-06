import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, discoveredServer, remoteServer } from '@/storybook/fixtures';
import { apiError, apiRequest } from '@/storybook/mock-api';
import { AddFoundServerDialog } from './add-found-server-dialog.tsx';

const INSTALL_ROUTE = 'POST /api/servers';
const found = discoveredServer();

const meta = {
  component: AddFoundServerDialog,
  args: { server: found, open: true, onOpenChange: fn() },
  parameters: {
    a11y: { test: 'error' },
    api: { ...appRoutes(), [INSTALL_ROUTE]: remoteServer({ name: 'skills' }) },
  },
} satisfies Meta<typeof AddFoundServerDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AsksForANameAndTheTokenItNeeds: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' }));
    await expect(dialog.getByText(found.url)).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Local name/ })).toHaveValue('skills');
    await expect(dialog.getByLabelText(/^Token/)).toHaveValue('');
  },
};

export const AddsItWithTheTokenAsABearerHeader: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' }));
    await userEvent.type(dialog.getByLabelText(/^Token/), 'secret-token');
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(INSTALL_ROUTE, {
        name: 'skills',
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: found.url, headers: { Authorization: 'Bearer secret-token' } },
        env: {},
        enabled: true,
        discovered: { key: found.key, cardName: found.cardName },
      }),
    );
    await waitFor(() => expect(body.getByText('Added skills')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const WillNotAddWithoutTheToken: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));
    await expect(await dialog.findByText('Required')).toBeVisible();
    await expect(apiRequest).not.toHaveBeenCalledWith(INSTALL_ROUTE, expect.anything());
  },
};

export const AddsOneThatNeedsNoToken: Story = {
  args: { server: discoveredServer({ requiredHeaders: [] }) },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' }));
    await expect(dialog.queryByLabelText(/^Token/)).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        INSTALL_ROUTE,
        expect.objectContaining({ transport: { type: 'streamable-http', url: found.url, headers: {} } }),
      ),
    );
  },
};

export const KeepsTheDialogOpenWhenTheNameIsTaken: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      [INSTALL_ROUTE]: apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Server "skills" already exists'),
    },
  },
  args: { server: discoveredServer({ requiredHeaders: [] }) },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Add MCP Skills on nas' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Add server' }));
    await waitFor(() => expect(body.getByText('Server "skills" already exists')).toBeVisible());
    await expect(args.onOpenChange).not.toHaveBeenCalledWith(false);
    await expect(dialog.getByRole('textbox', { name: /^Local name/ })).toHaveValue('skills');
  },
};
