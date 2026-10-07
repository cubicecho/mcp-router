import { ServerRuntimeState } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ServerStateBadge } from './state-badge.tsx';

const meta = {
  component: ServerStateBadge,
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ServerStateBadge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: { state: ServerRuntimeState.Running },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('running')).toBeVisible();
  },
};

export const Starting: Story = {
  args: { state: ServerRuntimeState.Starting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('starting')).toBeVisible();
    await expect(canvas.getByRole('status', { name: 'Starting' })).toBeVisible();
  },
};

export const FailedShowsWhyOnHover: Story = {
  args: { state: ServerRuntimeState.Error, lastError: 'spawn node ENOENT' },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByText('error'));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('tooltip')).toHaveTextContent('spawn node ENOENT');
  },
};
