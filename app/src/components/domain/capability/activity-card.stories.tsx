import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { activityEntry } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { ActivityCard } from './activity-card.tsx';

const ACTIVITY = 'GET /api/servers/filesystem/activity';
const CLEAR = 'DELETE /api/servers/filesystem/activity';
/** The first load and the one the Refresh button asks for. */
const LOADS_AFTER_REFRESH = 2;

const read = activityEntry();
const failedRead = activityEntry({
  id: 2,
  via: 'aggregate',
  target: 'missing.txt',
  ok: false,
  durationMs: 7,
  params: { name: 'read_file', arguments: { path: '/tmp/missing.txt' } },
  result: undefined,
  error: 'ENOENT: no such file or directory',
});
const listing = activityEntry({
  id: 3,
  via: 'ui',
  method: 'tools/list',
  target: undefined,
  params: undefined,
  result: undefined,
});
const entries = [listing, failedRead, read];

const meta = {
  component: ActivityCard,
  args: { scope: { kind: 'server', name: 'filesystem' } },
  parameters: { api: { [ACTIVITY]: { entries } } },
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Picks an option of one of the two filters, and waits for its list to close. */
async function chooseFilter(canvasElement: HTMLElement, filter: string, option: string): Promise<void> {
  await userEvent.click(within(canvasElement).getByRole('combobox', { name: filter }));
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole('option', { name: option }));
  await waitFor(() => expect(body.queryByRole('option')).not.toBeInTheDocument());
}

export const ListsEveryRecordedCall: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: /tools\/call.*read_file/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /tools\/call.*missing\.txt/ })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /tools\/list/ })).toBeVisible();
    await expect(canvas.getByText('error')).toBeVisible();
    await expect(canvas.getAllByText('ok')).toHaveLength(entries.length - 1);
    await expect(canvas.getByText('aggregate')).toBeVisible();
    await expect(canvas.getByText('ui')).toBeVisible();
    await expect(canvas.getByText('7ms')).toBeVisible();
    await expect(canvas.getByText(/proxied to this server/)).toBeVisible();
  },
};

export const OpensACallToShowItsRequestAndResponse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByRole('button', { name: /tools\/call.*read_file/ });
    await userEvent.click(row);
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('Request')).toBeVisible();
    await expect(canvas.getByText(/"path": "\/tmp\/notes.txt"/)).toBeVisible();
    await expect(canvas.getByText('Response')).toBeVisible();
    await expect(canvas.getByText(/"text": "hello"/)).toBeVisible();
  },
};

export const OpensAFailedCallToShowItsError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /tools\/call.*missing\.txt/ }));
    await expect(canvas.getByText('ENOENT: no such file or directory')).toBeVisible();
    await expect(canvas.getByText('Request')).toBeVisible();
    await expect(canvas.queryByText('Response')).not.toBeInTheDocument();
  },
};

export const FiltersToTheFailedCalls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await chooseFilter(canvasElement, 'Filter by outcome', 'Errors');
    await expect(canvas.getByRole('button', { name: /missing\.txt/ })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /read_file/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /tools\/list/ })).not.toBeInTheDocument();
  },
};

export const FiltersToOneMethod: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await chooseFilter(canvasElement, 'Filter by method', 'tools/list');
    await expect(canvas.getByRole('button', { name: /tools\/list/ })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /tools\/call/ })).not.toBeInTheDocument();
  },
};

export const SaysWhenNoCallMatchesTheFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await chooseFilter(canvasElement, 'Filter by outcome', 'Errors');
    await chooseFilter(canvasElement, 'Filter by method', 'tools/list');
    await expect(canvas.getByText('No entries match the current filters.')).toBeVisible();
    await chooseFilter(canvasElement, 'Filter by outcome', 'All');
    await expect(canvas.getByRole('button', { name: /tools\/list/ })).toBeVisible();
  },
};

export const RefreshesOnRequest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await userEvent.click(canvas.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(apiRequest.mock.calls.filter(([key]) => key === ACTIVITY)).toHaveLength(LOADS_AFTER_REFRESH),
    );
  },
};

export const ClearsOnlyAfterConfirming: Story = {
  parameters: { api: { [ACTIVITY]: { entries }, [CLEAR]: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await userEvent.click(canvas.getByRole('button', { name: 'Clear activity' }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('alertdialog', { name: 'Clear the activity log?' }));
    await waitFor(() => expect(dialog.getByText(/Every recorded call to this server is removed/)).toBeVisible());
    await expect(apiRequest).not.toHaveBeenCalledWith(CLEAR, undefined);
    await userEvent.click(dialog.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(CLEAR, undefined));
    await waitFor(() => expect(body.getByText('Activity cleared')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const KeepsTheLogWhenClearingIsCancelled: Story = {
  parameters: { api: { [ACTIVITY]: { entries }, [CLEAR]: null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await userEvent.click(canvas.getByRole('button', { name: 'Clear activity' }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
    await expect(apiRequest).not.toHaveBeenCalledWith(CLEAR, undefined);
    await expect(canvas.getByRole('button', { name: /tools\/list/ })).toBeVisible();
  },
};

export const SaysWhyClearingFailed: Story = {
  parameters: {
    api: {
      [ACTIVITY]: { entries },
      [CLEAR]: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'Could not clear the log'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('button', { name: /tools\/list/ });
    await userEvent.click(canvas.getByRole('button', { name: 'Clear activity' }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(body.getByText('Could not clear the log')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
    await expect(canvas.getByRole('button', { name: /tools\/list/ })).toBeVisible();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { [ACTIVITY]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument();
    await expect(canvas.queryByText(/No activity yet/)).not.toBeInTheDocument();
  },
};

export const WithNoCallsYet: Story = {
  parameters: { api: { [ACTIVITY]: { entries: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(
        'No activity yet. Calls made through /mcp/filesystem or the aggregate /mcp endpoint will appear here.',
      ),
    ).toBeVisible();
    const clear = canvas.getByRole('button', { name: 'Clear activity' });
    await expect(clear).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(clear);
    await expect(within(canvasElement.ownerDocument.body).queryByRole('alertdialog')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('combobox')).not.toBeInTheDocument();
  },
};

export const WithNoCallsYetInAWorkspace: Story = {
  args: { scope: { kind: 'workspace', slug: 'research' } },
  parameters: { api: { 'GET /api/workspaces/research/activity': { entries: [] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText('No activity yet. Calls made through /mcp/w/research will appear here.'),
    ).toBeVisible();
    await expect(canvas.getByText(/proxied through this workspace's members/)).toBeVisible();
  },
};

export const FailedToLoad: Story = {
  parameters: { api: { [ACTIVITY]: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'The log is gone') } },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load activity')).toBeVisible();
    await expect(alert.getByText('The log is gone')).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};
