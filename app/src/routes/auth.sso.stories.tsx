import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { forgetSession, sessionToken } from '@/lib/session';
import { appRoutes } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const OPERATOR_ID = '00000000-0000-4000-8000-0000000000c1';

const meta = {
  title: 'routes/auth-sso',
  parameters: {
    route: '/auth/sso?token=one-time',
    api: { ...appRoutes(), VerifyOneTimeToken: { verifyOneTimeToken: { token: 'sso-session', userId: OPERATOR_ID } } },
  },
  beforeEach: () => {
    forgetSession();
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SpendsTheTokenAndOpensTheApp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(sessionToken()).toBe('sso-session');
    await expect(apiRequest).toHaveBeenCalledWith('VerifyOneTimeToken', { token: 'one-time' });
  },
};

export const WhileSigningIn: Story = {
  parameters: { api: { ...appRoutes(), VerifyOneTimeToken: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Signing in', level: 1 })).toBeVisible();
    await expect(canvas.getByRole('status', { name: 'Signing in' })).toBeVisible();
  },
};

export const WhenTheTokenIsSpentOrExpired: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      VerifyOneTimeToken: apiError(HttpStatus.Ok, ErrorCode.Unauthenticated, 'Invalid or expired sign-in.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: "Sign-in didn't finish" })).toBeVisible();
    await expect(canvas.getByRole('alert')).toHaveTextContent(/only once\. Start it again\./);
    await expect(sessionToken()).toBeNull();

    await userEvent.click(canvas.getByRole('link', { name: 'Back to sign-in' }));
    await expect(await canvas.findByRole('heading', { name: 'Sign in to MCP Router' })).toBeVisible();
  },
};

export const WithoutAToken: Story = {
  parameters: { route: '/auth/sso' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: "Sign-in didn't finish" })).toBeVisible();
    await waitFor(() => expect(apiRequest).not.toHaveBeenCalledWith('VerifyOneTimeToken', expect.anything()));
  },
};
