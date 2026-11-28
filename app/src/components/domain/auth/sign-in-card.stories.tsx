import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SsoSource } from '@/__generated__/graphql';
import { ssoSetup } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { SignInCard } from './sign-in-card.tsx';

const REDIRECT_URI = ssoSetup().redirectUri;
const NOT_PAIRED = ssoSetup({ source: SsoSource.None, name: null, issuer: null });

const meta = {
  component: SignInCard,
  parameters: { api: { SsoSetup: { ssoSetup: ssoSetup() } } },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SignInCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithAPairedProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Sign-in', level: 2 })).toBeVisible();
    await expect(await canvas.findByText('Heautou')).toBeVisible();
    await expect(canvas.getByText('Paired from a setup URL.')).toBeVisible();
    await expect(canvas.getByText('https://id.example.test')).toBeVisible();
    await expect(canvas.getByText(REDIRECT_URI)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Copy redirect URI' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Disconnect provider' })).toBeVisible();
  },
};

export const DisconnectsOnlyAfterConfirming: Story = {
  parameters: {
    api: {
      SsoSetup: { ssoSetup: ssoSetup() },
      UnpairSso: { unpairSso: NOT_PAIRED },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Disconnect provider' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Disconnect Heautou?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('UnpairSso', expect.anything());

    await userEvent.click(dialog.getByRole('button', { name: 'Disconnect provider' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('UnpairSso', {}));
    await waitFor(() => expect(body.getByText('Disconnected Heautou')).toBeVisible());
  },
};

export const FromTheEnvironment: Story = {
  parameters: {
    api: { SsoSetup: { ssoSetup: ssoSetup({ source: SsoSource.Env, canPair: false, issuer: null }) } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/in the server's environment\. Change it there\./)).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Disconnect provider' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('textbox', { name: 'Setup URL' })).not.toBeInTheDocument();
    await expect(canvas.getByText(REDIRECT_URI)).toBeVisible();
  },
};

export const OffersPairingWithNoProvider: Story = {
  parameters: { api: { SsoSetup: { ssoSetup: NOT_PAIRED } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('None')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Setup URL' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Disconnect provider' })).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { SsoSetup: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Sign-in' })).toBeVisible();
    await expect(canvas.queryByText('Redirect URI')).not.toBeInTheDocument();
  },
};

export const WhenLoadingFails: Story = {
  parameters: {
    api: { SsoSetup: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'database down') },
  },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load how sign-in is set up')).toBeVisible();
  },
};
