import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TokenForm } from './token-form.tsx';

const meta = {
  component: TokenForm,
  args: { onUnlock: fn() },
} satisfies Meta<typeof TokenForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AsksForTheToken: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
    await expect(canvas.getByLabelText('Token')).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  },
};

export const UnlocksWithTheTrimmedToken: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Token'), '  s3cret  ');
    await userEvent.click(canvas.getByRole('button', { name: 'Unlock' }));
    await expect(args.onUnlock).toHaveBeenCalledWith('s3cret');
    await expect(canvas.getByLabelText('Token')).toHaveValue('');
  },
};

export const UnlocksOnEnter: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.type(within(canvasElement).getByLabelText('Token'), 's3cret{Enter}');
    await expect(args.onUnlock).toHaveBeenCalledWith('s3cret');
  },
};

export const RefusesATokenOfOnlySpaces: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Token'), '   {Enter}');
    await expect(canvas.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    await expect(args.onUnlock).not.toHaveBeenCalled();
  },
};

export const ShowsTheTokenOnRequest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('Token');
    await userEvent.type(input, 's3cret');
    await expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(canvas.getByRole('button', { name: 'Show token' }));
    await expect(input).toHaveAttribute('type', 'text');
    await userEvent.click(canvas.getByRole('button', { name: 'Hide token' }));
    await expect(input).toHaveAttribute('type', 'password');
  },
};
