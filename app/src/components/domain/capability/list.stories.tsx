import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EmptyState } from '@/components/page';
import { toolsResponse } from '@/storybook/fixtures';
import { CapabilityList, CapabilityRow } from './list.tsx';

const rows = toolsResponse().tools.map((tool) => (
  <CapabilityRow
    key={tool.name}
    title={tool.name}
    description={tool.description}
    contentSlot={<p>Everything about {tool.name}.</p>}
  />
));

const meta = {
  component: CapabilityList,
  args: {
    title: 'Tools',
    description: 'Tools reported by the downstream server.',
    what: 'tools',
    query: { isPending: false, error: null, refetch: fn() },
    emptySlot: <EmptyState compact title="No tools reported." />,
    contentSlot: rows,
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CapabilityList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsEveryRowFolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Tools', level: 2 })).toBeVisible();
    await expect(canvas.getByText('Tools reported by the downstream server.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /read_file/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByRole('button', { name: /list_files/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByText('Everything about read_file.')).not.toBeInTheDocument();
  },
};

export const OpensOneRowAtATimeOnItsHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.getByRole('button', { name: /read_file/ });
    await userEvent.click(heading);
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('Everything about read_file.')).toBeVisible();
    await expect(canvas.queryByText('Everything about list_files.')).not.toBeInTheDocument();
    await userEvent.click(heading);
    await expect(canvas.queryByText('Everything about read_file.')).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  args: { query: { isPending: true, error: null, refetch: fn() }, contentSlot: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Tools' })).toBeVisible();
    await expect(canvas.queryByText('No tools reported.')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

export const WithNothingToList: Story = {
  args: { contentSlot: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No tools reported.')).toBeVisible();
  },
};

export const FailedOffersARetry: Story = {
  args: { query: { isPending: false, error: new Error('spawn node ENOENT'), refetch: fn() }, contentSlot: [] },
  play: async ({ args, canvasElement }) => {
    const alert = within(within(canvasElement).getByRole('alert'));
    await expect(alert.getByText('Could not load tools')).toBeVisible();
    await expect(alert.getByText('spawn node ENOENT')).toBeVisible();
    await userEvent.click(alert.getByRole('button', { name: 'Try again' }));
    await expect(args.query.refetch).toHaveBeenCalled();
  },
};

export const AFailedRefreshKeepsTheLastRows: Story = {
  args: { query: { isPending: false, error: new Error('The server went away'), refetch: fn() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('The server went away');
    await expect(canvas.getByRole('button', { name: /read_file/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /list_files/ })).toBeVisible();
  },
};
