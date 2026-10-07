import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { getToken, setToken } from '@/lib/auth';
import { appRoutes, routerStatus } from '@/storybook/fixtures';
import { type ApiRoutes, apiError, apiRequest } from '@/storybook/mock-api';

const TOKEN = 'correct-token';
const LOCK_LABEL = 'Lock (forget the stored token)';

/** A router with auth on: every route answers 401 until the stored token is the right one. */
function lockedRoutes(): ApiRoutes {
  const open: ApiRoutes = { ...appRoutes(), 'GET /api/status': routerStatus({ authEnabled: true }) };
  const locked: ApiRoutes = {};
  for (const [key, answer] of Object.entries(open)) {
    locked[key] = () =>
      getToken() === TOKEN ? answer : apiError(HttpStatus.Unauthorized, ErrorCode.Unauthenticated, 'Token required');
  }
  return locked;
}

const meta = {
  title: 'routes/root',
  parameters: { route: '/', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheAppFrame: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('navigation', { name: 'Main' })).toBeVisible();
    for (const name of ['Servers', 'Browse', 'Workspaces', 'Registries', 'Settings']) {
      await expect(canvas.getByRole('link', { name })).toBeVisible();
    }
    // The status is drawn in the sidebar and in the narrow-screen bar; one of the two is on screen.
    await waitFor(() =>
      expect(canvas.getAllByText('1/2 servers running').some((line) => line.checkVisibility())).toBe(true),
    );
    // With auth off there is no token to forget.
    await expect(canvas.queryByRole('button', { name: LOCK_LABEL })).not.toBeInTheDocument();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const NavigatesWithTheSidebar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: 'Servers', current: 'page' })).toBeVisible();
    await userEvent.click(canvas.getByRole('link', { name: 'Workspaces' }));
    await expect(await canvas.findByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Workspaces', current: 'page' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: 'Servers', current: 'page' })).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole('link', { name: 'Settings' }));
    await expect(await canvas.findByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Settings', current: 'page' })).toBeVisible();
  },
};

export const KeepsServersCurrentOnAServerPage: Story = {
  parameters: { route: '/servers/filesystem' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Servers', current: 'page' })).toBeVisible();
  },
};

export const AsksForTheTokenWhenTheApiAnswers401: Story = {
  parameters: { api: lockedRoutes() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Authentication required' })).toBeVisible();
    await expect(canvas.getByLabelText('Token')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    // The app behind the screen is gone, not just covered.
    await expect(canvas.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  },
};

export const UnlocksWithTheToken: Story = {
  parameters: { api: lockedRoutes() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Token'), `  ${TOKEN} `);
    await userEvent.click(canvas.getByRole('button', { name: 'Unlock' }));

    await expect(await canvas.findByRole('link', { name: 'Filesystem' })).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'Authentication required' })).not.toBeInTheDocument();
    await expect(getToken()).toBe(TOKEN);
  },
};

export const AsksAgainWhenTheTokenIsWrong: Story = {
  parameters: { api: lockedRoutes() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Token'), 'wrong-token');
    apiRequest.mockClear();
    await userEvent.click(canvas.getByRole('button', { name: 'Unlock' }));

    // The app comes back, asks the server again with the new token, and is turned away again.
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('GET /api/status', undefined));
    await expect(await canvas.findByRole('heading', { name: 'Authentication required' })).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText('Token')).toHaveValue(''));
  },
};

export const LocksAndForgetsTheToken: Story = {
  parameters: { api: lockedRoutes() },
  beforeEach: () => {
    setToken(TOKEN);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: LOCK_LABEL }));

    await expect(await canvas.findByRole('heading', { name: 'Authentication required' })).toBeVisible();
    await expect(getToken()).toBeNull();
    // The tooltip of the button that was pressed is gone with it.
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    );
  },
};
