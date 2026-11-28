import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { useAppForm } from '@/components/app-form';
import type { KeyValueRow } from '@/lib/key-value';
import { KeyValueField } from './key-value-field.tsx';

/**
 * A form holding one list of rows, so typing, adding and removing go through the bound field.
 *
 * @param props.rows - The rows the form starts with.
 * @param props.onRowsChange - Told of the rows after every change.
 * @returns The field inside its form.
 */
function Form({ rows, onRowsChange }: { rows: KeyValueRow[]; onRowsChange: (rows: KeyValueRow[]) => void }) {
  const form = useAppForm({ defaultValues: { env: rows } });
  return (
    <div className="max-w-xl p-6">
      <KeyValueField
        form={form}
        name="env"
        label="Environment variables"
        keyLabel="Variable"
        valueLabel="Value"
        addLabel="Add variable"
        emptyTitle="No variables"
        listeners={{ onChange: ({ value }) => onRowsChange(value) }}
      />
    </div>
  );
}

const meta = {
  component: Form,
  args: {
    rows: [
      { key: 'ROOT_DIR', value: '/tmp' },
      { key: 'LOG_LEVEL', value: 'debug' },
    ],
    onRowsChange: fn(),
  },
} satisfies Meta<typeof Form>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryPairUnderItsLabel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Environment variables' })).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Variable 1' })).toHaveValue('ROOT_DIR');
    await expect(canvas.getByRole('textbox', { name: 'Value 2' })).toHaveValue('debug');
  },
};

export const AddsAndRemovesRows: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove row 1' }));
    await expect(args.onRowsChange).toHaveBeenLastCalledWith([{ key: 'LOG_LEVEL', value: 'debug' }]);
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Variable 2' }), 'API_KEY');
    await expect(args.onRowsChange).toHaveBeenLastCalledWith([
      { key: 'LOG_LEVEL', value: 'debug' },
      { key: 'API_KEY', value: '' },
    ]);
  },
};

export const SaysSoWithNoRows: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No variables')).toBeVisible();
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument();
  },
};
