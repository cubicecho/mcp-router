import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ComponentProps, useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { KeyValueRows } from './rows.tsx';

/** Holds the rows the way a form field would, so typing and removing show on screen. */
function Held(props: ComponentProps<typeof KeyValueRows>) {
  const [rows, setRows] = useState(props.value);
  return (
    <div className="max-w-xl p-6">
      <KeyValueRows
        {...props}
        value={rows}
        onValueChange={(next) => {
          setRows(next);
          props.onValueChange(next);
        }}
      />
    </div>
  );
}

const meta = {
  component: KeyValueRows,
  render: (args) => <Held {...args} />,
  args: {
    legend: 'Environment variables',
    keyLabel: 'Variable name',
    unnamed: 'new variable',
    addLabel: 'Add variable',
    value: [
      { key: 'ROOT_DIR', value: '/tmp' },
      { key: 'LOG_LEVEL', value: 'debug' },
    ],
    onValueChange: fn(),
  },
} satisfies Meta<typeof KeyValueRows>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryPair: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Environment variables')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Value for ROOT_DIR' })).toHaveValue('/tmp');
    await expect(canvas.getByRole('textbox', { name: 'Value for LOG_LEVEL' })).toHaveValue('debug');
    await expect(canvas.getAllByRole('textbox', { name: 'Variable name' })).toHaveLength(2);
  },
};

export const AddsAnEmptyRow: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }));
    await expect(canvas.getByRole('textbox', { name: 'Value for new variable' })).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Remove new variable' })).toBeVisible();
    await expect(args.onValueChange).toHaveBeenLastCalledWith([...args.value, { key: '', value: '' }]);
  },
};

export const NamesARowAfterItsKey: Story = {
  args: { value: [] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Variable name' }), 'API_KEY');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Value for API_KEY' }), 'abc');
    await expect(canvas.getByRole('button', { name: 'Remove API_KEY' })).toBeVisible();
    await expect(args.onValueChange).toHaveBeenLastCalledWith([{ key: 'API_KEY', value: 'abc' }]);
  },
};

export const RemovesOnlyTheChosenRow: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove ROOT_DIR' }));
    await expect(canvas.queryByRole('textbox', { name: 'Value for ROOT_DIR' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Value for LOG_LEVEL' })).toHaveValue('debug');
    await expect(args.onValueChange).toHaveBeenLastCalledWith([{ key: 'LOG_LEVEL', value: 'debug' }]);
  },
};

export const WithNoRowsKeepsTheLegend: Story = {
  args: { value: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Environment variables')).toBeVisible();
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Add variable' })).toBeVisible();
  },
};

export const HidesTheLegendUntilThereIsARow: Story = {
  args: { value: [], hideLegendWhenEmpty: true, legend: 'Headers', addLabel: 'Add header' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Headers')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Add header' }));
    await expect(canvas.getByText('Headers')).toBeVisible();
  },
};
