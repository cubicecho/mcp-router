import { ErrorCode, HttpStatus, MS_PER_MINUTE } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, reloadResult, routerStatus, settingsResult } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const TIMEOUT_LABEL = 'Idle timeout in minutes';
const NEW_TIMEOUT_MINUTES = 10;
const NEW_TIMEOUT_MS = NEW_TIMEOUT_MINUTES * MS_PER_MINUTE;

const meta = {
  title: 'routes/settings',
  parameters: { route: '/settings', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheRouterStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(await canvas.findByText('2.7.1')).toBeVisible();
    await expect(canvas.getByText('1/2 running')).toBeVisible();
    await expect(canvas.getByText('disabled')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: TIMEOUT_LABEL })).toHaveValue('5');
    // Nothing to save until the timeout changes.
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(canvas.getByRole('link', { name: 'Settings', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WithAuthOn: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/status': routerStatus({ authEnabled: true }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('enabled')).toBeVisible();
    await expect(canvas.queryByText('disabled')).not.toBeInTheDocument();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/status': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Router' })).toBeVisible();
    await expect(canvas.queryByText('Version')).not.toBeInTheDocument();
    await expect(canvas.queryByRole('textbox', { name: TIMEOUT_LABEL })).not.toBeInTheDocument();
    // The part that needs no status is there already.
    await expect(canvas.getByRole('button', { name: 'Reload config' })).toBeVisible();
  },
};

export const WhenTheStatusFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'GET /api/status': apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'settings.json is unreadable'),
    },
  },
  play: async ({ canvasElement }) => {
    const alert = within(await within(canvasElement).findByRole('alert'));
    await expect(alert.getByText('Could not load status')).toBeVisible();
    await expect(alert.getByText('settings.json is unreadable')).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

export const SavesTheIdleTimeout: Story = {
  parameters: {
    api: { ...appRoutes(), 'PATCH /api/settings': settingsResult({ idleTimeoutMs: NEW_TIMEOUT_MS }) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole('textbox', { name: TIMEOUT_LABEL });
    await userEvent.clear(input);
    await userEvent.type(input, String(NEW_TIMEOUT_MINUTES));
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('PATCH /api/settings', { idleTimeoutMs: NEW_TIMEOUT_MS }),
    );
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByText('Idle timeout saved')).toBeVisible());
  },
};

export const RefusesATimeoutThatIsNotPositive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole('textbox', { name: TIMEOUT_LABEL });
    await userEvent.clear(input);
    await userEvent.type(input, '0');

    await expect(input).toBeInvalid();
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(apiRequest).not.toHaveBeenCalledWith('PATCH /api/settings', expect.anything());
  },
};

export const WhenSavingFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'PATCH /api/settings': apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'settings.json is read-only'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole('textbox', { name: TIMEOUT_LABEL });
    await userEvent.clear(input);
    await userEvent.type(input, String(NEW_TIMEOUT_MINUTES));
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('settings.json is read-only')).toBeVisible(),
    );
    // What was typed is kept, to be tried again.
    await expect(input).toHaveValue(String(NEW_TIMEOUT_MINUTES));
  },
};

export const ReloadsTheConfig: Story = {
  parameters: { api: { ...appRoutes(), 'POST /api/reload': reloadResult() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Reload config' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('POST /api/reload', undefined));
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Configuration reloaded')).toBeVisible(),
    );
  },
};
