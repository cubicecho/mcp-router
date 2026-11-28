import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { apiKey } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { ApiKeysCard, IMPORTED_KEY_NAME } from './api-keys-card.tsx';

const KEY = apiKey();
const UNUSED = apiKey({ id: '00000000-0000-4000-8000-0000000000a2', name: 'CI', start: 'mcpr_c1d2', lastUsedAt: null });
const IMPORTED = apiKey({ id: '00000000-0000-4000-8000-0000000000a3', name: IMPORTED_KEY_NAME, start: null });

const meta = {
  component: ApiKeysCard,
  parameters: { api: { ApiKeys: { apiKeys: [KEY, UNUSED] } } },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApiKeysCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsTheKeys: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'API keys', level: 2 })).toBeVisible();
    await expect(canvas.getByText('Authorization: Bearer <key>')).toBeVisible();
    await expect(await canvas.findByText('Claude Code')).toBeVisible();
    await expect(canvas.getByText(/^mcpr_7f3a… · created/)).toBeVisible();
    await expect(canvas.getByText(/^used .+ ago$/)).toBeVisible();
    await expect(canvas.getByText('never used')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Revoke CI' })).toBeVisible();
    await expect(canvas.queryByText(/Imported router token/)).not.toBeInTheDocument();
  },
};

export const WithNoKeys: Story = {
  parameters: { api: { ApiKeys: { apiKeys: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('No API keys yet. Create one for each client that connects.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Create API key' })).toBeVisible();
  },
};

export const ExplainsTheImportedToken: Story = {
  parameters: { api: { ApiKeys: { apiKeys: [IMPORTED, KEY] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/was kept as a key named “Imported router token”/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: `Revoke ${IMPORTED_KEY_NAME}` })).toBeVisible();
  },
};

export const RevokesOnlyAfterConfirming: Story = {
  parameters: { api: { ApiKeys: { apiKeys: [KEY, UNUSED] }, RevokeApiKey: { revokeApiKey: true } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Revoke CI' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Revoke CI?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('RevokeApiKey', expect.anything());

    await userEvent.click(dialog.getByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('RevokeApiKey', { id: UNUSED.id }));
    await waitFor(() => expect(body.getByText('Revoked CI')).toBeVisible());
    // The list is read again.
    await waitFor(() => expect(apiRequest.mock.calls.filter(([name]) => name === 'ApiKeys')).toHaveLength(2));
  },
};

export const OpensTheCreateDialog: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Create API key' }));
    await expect(await body.findByRole('dialog', { name: 'Create API key' })).toBeVisible();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ApiKeys: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'API keys' })).toBeVisible();
    await expect(canvas.queryByText(/No API keys yet/)).not.toBeInTheDocument();
  },
};

export const WhenLoadingFails: Story = {
  parameters: {
    api: { ApiKeys: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'database down') },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load API keys')).toBeVisible();
    await expect(canvas.queryByText(/No API keys yet/)).not.toBeInTheDocument();
  },
};
