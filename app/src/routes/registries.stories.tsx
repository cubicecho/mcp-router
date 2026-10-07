import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { appRoutes, registry } from '@/storybook/fixtures';
import { apiError, apiRequest, pending } from '@/storybook/mock-api';

const MIRROR = registry({ name: 'mirror', url: 'https://mirror.example.test' });

const meta = {
  title: 'routes/registries',
  parameters: { route: '/registries', api: appRoutes() },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsTheRegistries: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Registries' })).toBeVisible();
    await expect(await canvas.findByRole('cell', { name: 'official' })).toBeVisible();
    await expect(canvas.getByRole('cell', { name: 'https://registry.modelcontextprotocol.io' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Registries', current: 'page' })).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const WhileLoading: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/registries': pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status')).toBeVisible();
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
  },
};

export const WithNoRegistries: Story = {
  parameters: { api: { ...appRoutes(), 'GET /api/registries': [] } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('cell', { name: 'No registries configured.' })).toBeVisible();
  },
};

export const WhenLoadingFails: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'GET /api/registries': apiError(
        HttpStatus.InternalServerError,
        ErrorCode.Internal,
        'registries.json is unreadable',
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = within(await canvas.findByRole('alert'));
    await expect(alert.getByText('Could not load registries')).toBeVisible();
    await expect(alert.getByText('registries.json is unreadable')).toBeVisible();
    await expect(canvas.queryByRole('table')).not.toBeInTheDocument();
  },
};

export const AddsARegistry: Story = {
  parameters: { api: { ...appRoutes(), 'POST /api/registries': MIRROR } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), ` ${MIRROR.name} `);
    await userEvent.type(canvas.getByRole('textbox', { name: 'URL' }), MIRROR.url);
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith('POST /api/registries', { name: MIRROR.name, url: MIRROR.url }),
    );
    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText(`Added registry ${MIRROR.name}`)).toBeVisible(),
    );
    // The form is ready for the next one.
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue(''));
  },
};

export const RefusesAUrlThatIsNotOne: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), MIRROR.name);
    await userEvent.type(canvas.getByRole('textbox', { name: 'URL' }), 'not a url');
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'URL' })).toBeInvalid());
    await expect(canvas.getByRole('textbox', { name: 'Name' })).toBeValid();
    await expect(apiRequest).not.toHaveBeenCalledWith('POST /api/registries', expect.anything());
  },
};

export const WhenTheNameIsTaken: Story = {
  parameters: {
    api: {
      ...appRoutes(),
      'POST /api/registries': apiError(HttpStatus.Conflict, ErrorCode.Conflict, 'Registry "official" already exists'),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), 'official');
    await userEvent.type(canvas.getByRole('textbox', { name: 'URL' }), MIRROR.url);
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(within(canvasElement.ownerDocument.body).getByText('Registry "official" already exists')).toBeVisible(),
    );
    // What was typed is kept, to be corrected.
    await expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue('official');
  },
};

export const DeletesOnlyAfterConfirming: Story = {
  parameters: { api: { ...appRoutes(), 'DELETE /api/registries/official': null } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete official' }));
    const dialog = within(await body.findByRole('alertdialog', { name: 'Delete registry official?' }));
    await expect(apiRequest).not.toHaveBeenCalledWith('DELETE /api/registries/official', undefined);

    await userEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('DELETE /api/registries/official', undefined));
    await waitFor(() => expect(body.getByText('Deleted registry official')).toBeVisible());
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
  },
};

export const KeepsTheRegistryWhenCancelled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delete official' }));
    const dialog = within(await body.findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument());
    await expect(apiRequest).not.toHaveBeenCalledWith('DELETE /api/registries/official', undefined);
    await expect(canvas.getByRole('cell', { name: 'official' })).toBeVisible();
  },
};
