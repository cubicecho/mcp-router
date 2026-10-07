import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { registryServer, stdioServer } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';
import { InstallDialog } from './install-dialog.tsx';

const INSTALL_ROUTE = 'POST /api/servers';
const REMOTE_URL = 'https://weather.example.test/mcp';

const meta = {
  component: InstallDialog,
  args: {
    registry: 'official',
    server: registryServer(),
    open: true,
    onOpenChange: fn(),
    onInstalled: fn(),
  },
  parameters: { api: { [INSTALL_ROUTE]: stdioServer({ name: 'weather' }) } },
} satisfies Meta<typeof InstallDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SuggestsANameAndAsksForTheDeclaredVariables: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await expect(dialog.getByRole('textbox', { name: /^Local name/ })).toHaveValue('weather');
    await expect(dialog.getByText('Route segment for this server: /mcp/weather')).toBeVisible();
    await expect(dialog.getByLabelText(/^WEATHER_API_KEY/)).toHaveAttribute('type', 'password');
    await expect(dialog.getByText('Key for the forecast API.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeEnabled();
  },
};

export const InstallsWithTheFilledInVariables: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.type(dialog.getByLabelText(/^WEATHER_API_KEY/), 'abc123');
    await userEvent.click(dialog.getByRole('button', { name: 'Add env var' }));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Variable name' }), 'UNITS');
    await userEvent.type(dialog.getByRole('textbox', { name: 'Value for UNITS' }), 'metric');
    await userEvent.click(dialog.getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(INSTALL_ROUTE, {
        name: 'weather',
        source: { type: 'registry', registry: 'official', serverName: 'io.github.example/weather', version: '1.2.0' },
        packageSelector: '0',
        env: { WEATHER_API_KEY: 'abc123', UNITS: 'metric' },
        enabled: true,
      }),
    );
    await waitFor(() => expect(body.getByText('Installed weather')).toBeVisible());
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(args.onInstalled).toHaveBeenCalledWith('weather');
  },
};

export const RejectsANameThatCannotBeARoute: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    const name = dialog.getByRole('textbox', { name: /^Local name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Bad Name');
    await expect(await dialog.findByText(/lowercase alphanumerics/)).toBeVisible();
    await expect(name).toBeInvalid();
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeDisabled();
    await expect(apiRequest).not.toHaveBeenCalled();
  },
};

export const ChoosingARemoteDropsThePackageVariables: Story = {
  args: {
    server: registryServer({ remotes: [{ type: 'streamable-http', url: REMOTE_URL }] }),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    // The dialog fades in, so the field is in the tree before it can be seen.
    await waitFor(() => expect(dialog.getByLabelText(/^WEATHER_API_KEY/)).toBeVisible());
    await userEvent.click(dialog.getByRole('combobox', { name: 'Package' }));
    await userEvent.click(await body.findByRole('option', { name: `streamable-http: ${REMOTE_URL}` }));
    await waitFor(() => expect(dialog.queryByLabelText(/^WEATHER_API_KEY/)).not.toBeInTheDocument());
    // The list hides the rest of the page from assistive tech until it has finished closing.
    await waitFor(() => expect(body.queryByRole('listbox')).not.toBeInTheDocument());

    await userEvent.click(dialog.getByRole('button', { name: 'Install' }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        INSTALL_ROUTE,
        expect.objectContaining({ packageSelector: 'remote:0', env: {} }),
      ),
    );
  },
};

export const ShowsWhyTheServerRefused: Story = {
  parameters: {
    api: {
      [INSTALL_ROUTE]: apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Server "weather" already exists'),
    },
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(body.getByText('Server "weather" already exists')).toBeVisible());
    // The dialog stays open with what was typed, so the name can be changed and sent again.
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await expect(args.onInstalled).not.toHaveBeenCalled();
    await expect(dialog.getByRole('button', { name: 'Install' })).toBeEnabled();
  },
};

export const WhileInstalling: Story = {
  parameters: { api: { [INSTALL_ROUTE]: pending() } },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Install' }));
    await expect(await dialog.findByRole('button', { name: /Installing…/ })).toBeDisabled();
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

export const AsksBeforeDiscardingWhatWasTyped: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.type(dialog.getByLabelText(/^WEATHER_API_KEY/), 'abc123');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    const question = within(await body.findByRole('alertdialog', { name: 'Discard your changes?' }));
    await expect(args.onOpenChange).not.toHaveBeenCalled();
    await userEvent.click(question.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const ClosesStraightAwayWhenNothingWasTyped: Story = {
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole('dialog', { name: 'Install Weather' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(body.queryByRole('alertdialog')).not.toBeInTheDocument();
  },
};
