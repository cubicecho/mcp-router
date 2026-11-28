import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { forgetSession, sessionToken } from '@/lib/session';
import { appRoutes, authConfig } from '@/storybook/fixtures';
import { apiError, apiRequest, STORY_SESSION } from '@/storybook/mock-api';

const SIGN_IN_HEADING = 'Sign in to MCP Router';
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000c1';

/**
 * Finds the Sign out button on screen: the sidebar draws one and the narrow-screen bar another.
 *
 * @param canvasElement - The story's root.
 * @returns The one that is visible.
 */
async function visibleSignOut(canvasElement: HTMLElement): Promise<HTMLElement> {
  const buttons = await within(canvasElement).findAllByRole('button', { name: 'Sign out' });
  const visible = buttons.find((button) => button.checkVisibility());
  if (visible === undefined) {
    throw new Error('No Sign out button is visible');
  }
  return visible;
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
    await expect(canvas.getAllByRole('button', { name: 'Sign out' }).some((button) => button.checkVisibility())).toBe(
      true,
    );
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

export const PutsSettingsAtTheFootOfTheSidebar: Story = {
  globals: { viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = within(await canvas.findByRole('navigation', { name: 'Main' }));
    await expect(nav.getByRole('link', { name: 'Registries' })).toBeVisible();
    // As in the other cubeui apps, Settings sits with the theme picker at the foot, not with the places.
    await expect(nav.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Settings' })).toBeVisible();
  },
};

export const ShowsSettingsInTheBarOnANarrowScreen: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The bar has no foot, so Settings is one of its places.
    const nav = within(await canvas.findByRole('navigation', { name: 'Main' }));
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
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

export const SendsASignedOutBrowserToSignIn: Story = {
  beforeEach: () => {
    forgetSession();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: SIGN_IN_HEADING })).toBeVisible();
    // The app is not drawn behind it, and asked the server for nothing of the operator's.
    await expect(canvas.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await expect(apiRequest).not.toHaveBeenCalledWith('Servers', expect.anything());
  },
};

export const ComesBackToThePageAskedForAfterSigningIn: Story = {
  parameters: {
    route: '/servers/filesystem',
    api: {
      ...appRoutes(),
      AuthConfig: authConfig({ trustedNetwork: true }),
      SignInOnTrustedNetwork: { signInOnTrustedNetwork: { token: 'local-session', userId: OPERATOR_ID } },
    },
  },
  beforeEach: () => {
    forgetSession();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Filesystem' })).toBeVisible();
    await expect(sessionToken()).toBe('local-session');
  },
};

export const SignsInAgainWhenTheSessionIsRefused: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      Servers: apiError(HttpStatus.Ok, ErrorCode.Unauthenticated, 'Sign in first.'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: SIGN_IN_HEADING })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Sign in with Heautou' })).toBeVisible();
    await expect(sessionToken()).toBeNull();
  },
};

export const SignsOut: Story = {
  globals: { viewport: { value: 'desktop' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(sessionToken()).toBe(STORY_SESSION);
    await userEvent.click(await visibleSignOut(canvasElement));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('SignOut', {}));
    await expect(await canvas.findByRole('heading', { name: SIGN_IN_HEADING })).toBeVisible();
    await expect(sessionToken()).toBeNull();
    // The tooltip of the button that was pressed is gone with it.
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    );
  },
};

export const SignsOutEvenWhenTheServerFails: Story = {
  globals: { viewport: { value: 'desktop' } },
  parameters: {
    api: { ...appRoutes(), SignOut: apiError(HttpStatus.InternalServerError, ErrorCode.Internal, 'database down') },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await visibleSignOut(canvasElement));
    await expect(await canvas.findByRole('heading', { name: SIGN_IN_HEADING })).toBeVisible();
    await expect(sessionToken()).toBeNull();
  },
};
