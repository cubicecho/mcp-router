import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { ssoSetup } from '@/storybook/fixtures';
import { apiError, apiRequest } from '@/storybook/mock-api';
import { PairProviderForm } from './pair-provider-form.tsx';

const SETUP_URL = 'https://id.example.test#setup=abc&name=Heautou';

const meta = {
  component: PairProviderForm,
  args: { onPaired: fn() },
  parameters: { api: { PairSso: { pairSso: ssoSetup() } } },
  decorators: [
    (Story) => (
      <div className="max-w-sm p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PairProviderForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PairsWithTheTrimmedUrl: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Setup URL' }), `  ${SETUP_URL}  `);
    await userEvent.click(canvas.getByRole('button', { name: 'Connect provider' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PairSso', { setupUrl: SETUP_URL }));
    await waitFor(() => expect(args.onPaired).toHaveBeenCalledWith('Heautou'));
  },
};

export const AsksForTheUrl: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Setup URL' });
    await expect(field).toBeRequired();
    await userEvent.type(field, ' ');
    await userEvent.clear(field);
    await expect(await canvas.findByText('Paste the setup URL.')).toBeVisible();
    await expect(args.onPaired).not.toHaveBeenCalled();
  },
};

export const SaysWhyTheProviderRefused: Story = {
  parameters: {
    api: { PairSso: apiError(HttpStatus.Ok, ErrorCode.BadUserInput, 'The setup token has expired.') },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Setup URL' }), SETUP_URL);
    await userEvent.click(canvas.getByRole('button', { name: 'Connect provider' }));

    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText("Couldn't connect the provider")).toBeVisible();
    await expect(alert.getByText(/The setup token has expired\. Check the setup URL/)).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Setup URL' })).toHaveValue(SETUP_URL);
    await expect(args.onPaired).not.toHaveBeenCalled();
  },
};
