import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { stdioServer } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { PackageInstallCard } from './package-install-card.tsx';

const INSTALL_ROUTE = 'POST /api/servers';

const meta = {
  component: PackageInstallCard,
  args: { ecosystem: 'npm', onInstalled: fn() },
  parameters: { api: { [INSTALL_ROUTE]: stdioServer({ name: 'weather-mcp' }) } },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PackageInstallCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InstallIsOffUntilAPackageIsNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Install from npm' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeDisabled();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@example/weather-mcp');
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled();
    // The local name that will be used is offered where it would be typed.
    await expect(canvas.getByRole('textbox', { name: 'Local name' })).toHaveAttribute('placeholder', 'weather-mcp');
  },
};

export const InstallsTheNamedPackage: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@example/weather-mcp');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Version' }), '1.2.0');
    await userEvent.click(canvas.getByRole('button', { name: 'Add env var' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Variable name' }), 'WEATHER_API_KEY');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Value for WEATHER_API_KEY' }), 'abc123');
    await userEvent.click(canvas.getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(INSTALL_ROUTE, {
        name: 'weather-mcp',
        source: { type: 'npm', package: '@example/weather-mcp', version: '1.2.0' },
        env: { WEATHER_API_KEY: 'abc123' },
        enabled: true,
      }),
    );
    await waitFor(() => expect(body.getByText('Installed weather-mcp')).toBeVisible());
    await expect(args.onInstalled).toHaveBeenCalledWith('weather-mcp');
    // The card is ready for the next package.
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Package' })).toHaveValue(''));
  },
};

export const InstallsFromPyPiUnderATypedName: Story = {
  args: { ecosystem: 'pypi' },
  parameters: { api: { [INSTALL_ROUTE]: stdioServer({ name: 'fetch' }) } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Install from PyPI' })).toBeVisible();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), 'mcp-server-fetch');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Local name' }), 'fetch');
    await userEvent.click(canvas.getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(INSTALL_ROUTE, {
        name: 'fetch',
        source: { type: 'pypi', package: 'mcp-server-fetch' },
        env: {},
        enabled: true,
      }),
    );
    await waitFor(() => expect(args.onInstalled).toHaveBeenCalledWith('fetch'));
  },
};

export const RejectsALocalNameThatCannotBeARoute: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@example/weather-mcp');
    const name = canvas.getByRole('textbox', { name: 'Local name' });
    await userEvent.type(name, 'Bad Name');
    await expect(await canvas.findByText(/lowercase alphanumerics/)).toBeVisible();
    await expect(name).toBeInvalid();
    await expect(canvas.getByRole('button', { name: 'Install' })).toBeDisabled();
    await expect(apiRequest).not.toHaveBeenCalled();
  },
};

export const ShowsWhyTheInstallFailed: Story = {
  parameters: {
    api: {
      [INSTALL_ROUTE]: apiError(
        HttpStatus.BadGateway,
        ErrorCode.UpstreamFailed,
        'npm install failed',
        'E404 @example/weather-mcp is not in this registry',
      ),
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@example/weather-mcp');
    await userEvent.click(canvas.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(body.getByText('npm install failed')).toBeVisible());
    await expect(body.getByText('E404 @example/weather-mcp is not in this registry')).toBeVisible();
    await expect(args.onInstalled).not.toHaveBeenCalled();
    // What was typed is kept, so it can be corrected and sent again.
    await expect(canvas.getByRole('textbox', { name: 'Package' })).toHaveValue('@example/weather-mcp');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Install' })).toBeEnabled());
  },
};

export const WhileInstalling: Story = {
  parameters: { api: { [INSTALL_ROUTE]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Package' }), '@example/weather-mcp');
    await userEvent.click(canvas.getByRole('button', { name: 'Install' }));
    await expect(await canvas.findByRole('button', { name: /Installing…/ })).toBeDisabled();
  },
};
