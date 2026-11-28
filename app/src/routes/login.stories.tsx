import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { forgetSession, sessionToken } from '@/lib/session';
import { appRoutes, authConfig, ssoSetup } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const HEADING = 'Sign in to MCP Router';
const SETUP_URL = 'https://id.example.test#setup=abc&name=Heautou';
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000c1';
const TRUSTED_SESSION = { signInOnTrustedNetwork: { token: 'local-session', userId: OPERATOR_ID } };

const meta = {
  title: 'routes/login',
  parameters: { route: '/login', api: appRoutes() },
  beforeEach: () => {
    forgetSession();
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OffersTheProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: HEADING, level: 1 })).toBeVisible();
    const link = await canvas.findByRole('link', { name: 'Sign in with Heautou' });
    // A full-page navigation to the server, which hands the browser to the provider.
    await expect(link).toHaveAttribute('href', 'about:blank#sign-in');
    await expect(canvas.queryByRole('textbox', { name: 'Setup URL' })).not.toBeInTheDocument();
    await expect(apiRequest).not.toHaveBeenCalledWith('SignInOnTrustedNetwork', expect.anything());
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const SignsInOnATrustedNetwork: Story = {
  parameters: {
    api: { ...appRoutes(), AuthConfig: authConfig({ trustedNetwork: true }), SignInOnTrustedNetwork: TRUSTED_SESSION },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Opening the page is signing in: no button to press, and the app opens.
    await expect(await canvas.findByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(sessionToken()).toBe('local-session');
    await expect(apiRequest.mock.calls.filter(([name]) => name === 'SignInOnTrustedNetwork')).toHaveLength(1);
  },
};

export const WhileSigningInOnATrustedNetwork: Story = {
  parameters: {
    api: { ...appRoutes(), AuthConfig: authConfig({ trustedNetwork: true }), SignInOnTrustedNetwork: pending() },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText('This router is on a trusted network, so opening it signs you in.'),
    ).toBeVisible();
    await expect(canvas.getByRole('status', { name: 'Signing in' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /Sign in with/ })).not.toBeInTheDocument();
  },
};

export const WhenTheTrustedSignInFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      AuthConfig: authConfig({ trustedNetwork: true }),
      SignInOnTrustedNetwork: apiError(HttpStatus.Ok, ErrorCode.Forbidden, 'This router is not on a trusted network.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText("Couldn't sign in")).toBeVisible();
    await expect(alert.getByText('This router is not on a trusted network.')).toBeVisible();
    apiRequest.mockClear();
    await userEvent.click(alert.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('SignInOnTrustedNetwork', {}));
    await expect(sessionToken()).toBeNull();
  },
};

/** A new router: no provider, and pairing allowed. Once paired, the page reads the provider back. */
function newRouterRoutes() {
  let isPaired = false;
  return {
    ...appRoutes(),
    AuthConfig: () => authConfig({ provider: isPaired ? 'Heautou' : null, canPair: isPaired === false }),
    PairSso: () => {
      isPaired = true;
      return { pairSso: ssoSetup({ canPair: true }) };
    },
  };
}

export const PairsAProviderOnANewRouter: Story = {
  parameters: { api: newRouterRoutes() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText('No sign-in provider is set up yet. Connect one to sign in with it.'),
    ).toBeVisible();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Setup URL' }), `  ${SETUP_URL} `);
    await userEvent.click(canvas.getByRole('button', { name: 'Connect provider' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('PairSso', { setupUrl: SETUP_URL }));
    // The provider's button takes the form's place.
    await expect(await canvas.findByRole('link', { name: 'Sign in with Heautou' })).toBeVisible();
    await expect(canvas.queryByRole('textbox', { name: 'Setup URL' })).not.toBeInTheDocument();
  },
};

export const WhenThePairingIsRefused: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      AuthConfig: authConfig({ provider: null, canPair: true }),
      PairSso: apiError(HttpStatus.Ok, ErrorCode.BadUserInput, 'The setup token has expired.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Setup URL' }), SETUP_URL);
    await userEvent.click(canvas.getByRole('button', { name: 'Connect provider' }));

    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText("Couldn't connect the provider")).toBeVisible();
    await expect(alert.getByText(/The setup token has expired\./)).toBeVisible();
    // What was pasted is kept, to be corrected.
    await expect(canvas.getByRole('textbox', { name: 'Setup URL' })).toHaveValue(SETUP_URL);
  },
};

export const SaysWhenThereIsNoWayToSignIn: Story = {
  parameters: { api: { ...appRoutes(), AuthConfig: authConfig({ provider: null, canPair: false }) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('No way to sign in yet')).toBeVisible();
    await expect(canvas.getByText('OIDC_ISSUER')).toBeVisible();
    await expect(canvas.queryByRole('textbox', { name: 'Setup URL' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: /Sign in with/ })).not.toBeInTheDocument();
  },
};

export const SaysWhenTheProviderSignInFailed: Story = {
  parameters: { route: '/login?error=access_denied' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText(/Signing in with your provider didn't finish/)).toBeVisible();
    // The way back in is still offered.
    await expect(await canvas.findByRole('link', { name: 'Sign in with Heautou' })).toBeVisible();
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), AuthConfig: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: HEADING })).toBeVisible();
    await expect(canvas.getByRole('status')).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /Sign in with/ })).not.toBeInTheDocument();
  },
};

export const WhenLoadingFails: Story = {
  parameters: {
    api: { ...appRoutes(), AuthConfig: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'database down') },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load how to sign in')).toBeVisible();
    await expect(alert.getByRole('button', { name: /Retry|Try again/ })).toBeVisible();
  },
};
