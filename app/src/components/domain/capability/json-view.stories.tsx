import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { activityEntry, toolCallResult } from '@/storybook/fixtures';
import { DataBlock } from './json-view.tsx';

const meta = {
  component: DataBlock,
  args: { label: 'Result', value: toolCallResult() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsPrettyTextFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Result')).toBeVisible();
    const views = within(canvas.getByRole('group', { name: 'Result view' }));
    await expect(views.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
    await expect(views.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByText(/"text": "hello from notes.txt"/)).toBeVisible();
  },
};

export const ShowsAStringAsItIs: Story = {
  args: { value: 'plain words, no quotes' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('plain words, no quotes')).toBeVisible();
  },
};

export const SwitchesToATree: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'JSON' }));
    await expect(canvas.getByRole('button', { name: 'JSON' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByText('"hello from notes.txt"')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Text' }));
    await expect(canvas.getByText(/"text": "hello from notes.txt"/)).toBeVisible();
  },
};

export const FoldsABranchOfTheTree: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'JSON' }));
    const branch = canvas.getByRole('button', { name: /"content"/ });
    await expect(branch).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(branch);
    await expect(branch).toHaveAttribute('aria-expanded', 'false');
    await expect(branch).toHaveTextContent('1 item');
    await expect(canvas.queryByText('"hello from notes.txt"')).not.toBeInTheDocument();
  },
};

export const StartsDeepLevelsFolded: Story = {
  args: { value: activityEntry() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'JSON' }));
    // result → content → [0] is the fourth level, one past what starts open.
    const deep = canvas.getByRole('button', { name: /2 keys/ });
    await expect(deep).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(deep);
    await expect(canvas.getByText('"hello"')).toBeVisible();
  },
};

export const DrillsIntoJsonHeldInAString: Story = {
  args: { value: toolCallResult({ content: [{ type: 'text', text: '{"files":["a.txt","b.txt"]}' }] }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'JSON' }));
    const embedded = canvas.getByRole('button', { name: /"text".*json/ });
    await expect(embedded).toBeVisible();
    await userEvent.click(embedded);
    await userEvent.click(canvas.getByRole('button', { name: /"files"/ }));
    await expect(canvas.getByText('"a.txt"')).toBeVisible();
  },
};

export const MarksAnErrorResult: Story = {
  args: { label: 'Tool returned an error', isError: true, value: toolCallResult({ isError: true }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Tool returned an error')).toBeVisible();
    await expect(canvas.getByRole('group', { name: 'Tool returned an error view' })).toBeVisible();
    await expect(canvas.getByText(/"isError": true/)).toBeVisible();
  },
};
