import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { oauthStart, signedInServer } from '@/storybook/fixtures';
import { apiError, apiRequest } from '@/storybook/mock-api';
import { OAuthSignInButton } from './oauth-sign-in-button.tsx';

/** The window the button opens: a hidden frame, so the story never leaves the page and the window is a real one. */
let signInWindow: Window | null = null;

/**
 * Makes `window.open` hand back a hidden frame's window, or nothing to play a blocked popup.
 *
 * @param blocked - Whether the browser "blocks" the window.
 * @returns The cleanup.
 */
function stubWindowOpen(blocked = false) {
  const realOpen = window.open;
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Sign-in window';
  document.body.append(frame);
  signInWindow = frame.contentWindow;
  window.open = () => (blocked ? null : signInWindow);
  return () => {
    window.open = realOpen;
    frame.remove();
    signInWindow = null;
  };
}

/**
 * Plays the router's callback page reporting back from the sign-in window.
 *
 * @param ok - Whether the login succeeded.
 */
function reportFromSignInWindow(ok: boolean) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'mcp-router-oauth', server: 'home-assistant', ok, ...(ok ? {} : { error: 'access_denied' }) },
      source: signInWindow,
    }),
  );
}

const meta = {
  component: OAuthSignInButton,
  args: { name: 'home-assistant' },
  beforeEach: () => stubWindowOpen(),
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OAuthSignInButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Sign in' })).toBeEnabled();
  },
};

export const OpensTheLoginAndHearsBack: Story = {
  parameters: {
    api: {
      'POST /api/servers/home-assistant/oauth/start': oauthStart(),
      'GET /api/servers': [signedInServer()],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('POST /api/servers/home-assistant/oauth/start', {
        origin: window.location.origin,
      }),
    );
    await expect(await canvas.findByRole('button', { name: /Waiting for sign-in/ })).toBeVisible();

    reportFromSignInWindow(true);

    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Signed in to home-assistant')).toBeVisible();
    await expect(await canvas.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  },
};

export const ReportsACancelledLogin: Story = {
  parameters: { api: { 'POST /api/servers/home-assistant/oauth/start': oauthStart() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));
    await canvas.findByRole('button', { name: /Waiting for sign-in/ });

    reportFromSignInWindow(false);

    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Signing in to home-assistant failed')).toBeVisible();
    await expect(body.getByText('access_denied')).toBeVisible();
  },
};

export const LinksTheLoginWhenTheWindowIsBlocked: Story = {
  beforeEach: () => stubWindowOpen(true),
  parameters: { api: { 'POST /api/servers/home-assistant/oauth/start': oauthStart() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));
    const link = await canvas.findByRole('link', { name: /Open the login page/ });
    await expect(link).toHaveAttribute('href', 'about:blank#login');
  },
};

export const ShowsWhyTheSignInCouldNotStart: Story = {
  parameters: {
    api: {
      'POST /api/servers/home-assistant/oauth/start': apiError(
        HttpStatus.BadGateway,
        ErrorCode.UpstreamFailed,
        'Could not start the sign-in for server "home-assistant"',
        'Incompatible auth server: does not support dynamic client registration',
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Sign in' }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Could not start the sign-in for server "home-assistant"')).toBeVisible();
    await expect(body.getByText(/does not support dynamic client registration/)).toBeVisible();
  },
};
