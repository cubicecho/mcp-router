import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { apiKey } from '@/storybook/fixtures';
import { apiError, apiRequest } from '@/storybook/mock-api';
import { CreateApiKeyDialog } from './create-api-key-dialog.tsx';

const SECRET = 'mcpr_7f3a9c2e1b4d6f8a0c2e4b6d8f0a1c3e';

const meta = {
  component: CreateApiKeyDialog,
  args: { open: true, onOpenChange: fn() },
  parameters: {
    api: { CreateApiKey: { createApiKey: { apiKey: apiKey({ lastUsedAt: null }), key: SECRET } } },
  },
} satisfies Meta<typeof CreateApiKeyDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CreatesAKeyAndShowsItOnce: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Create API key' }));
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), '  Claude Code ');
    await userEvent.click(dialog.getByRole('button', { name: 'Create API key' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('CreateApiKey', { name: 'Claude Code' }));
    const ready = within(await body.findByRole('dialog', { name: 'Claude Code is ready' }));
    await expect(ready.getByText(SECRET)).toBeVisible();
    await expect(ready.getByText(/It is not shown again/)).toBeVisible();
    await expect(ready.getByRole('button', { name: 'Copy API key' })).toBeVisible();
    await expect(ready.getByText('/mcp/w/<slug>')).toBeVisible();

    await userEvent.click(ready.getByRole('button', { name: 'Done' }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

export const AsksForAName: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
    const name = dialog.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeRequired();
    await userEvent.type(name, ' ');
    await expect(await dialog.findByText('Name the key.')).toBeVisible();
    await expect(apiRequest).not.toHaveBeenCalledWith('CreateApiKey', expect.anything());
  },
};

export const WhenCreatingFails: Story = {
  parameters: {
    api: { CreateApiKey: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'database down') },
  },
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'ci');
    await userEvent.click(dialog.getByRole('button', { name: 'Create API key' }));

    const alert = within(await dialog.findByRole('alert'));
    await expect(alert.getByText("Couldn't create the key")).toBeVisible();
    // The name is kept, and no secret is shown.
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('ci');
    await expect(dialog.queryByRole('button', { name: 'Copy API key' })).not.toBeInTheDocument();
  },
};
