import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { stdioServer } from '@/storybook/fixtures';
import { EnvEditor } from './env-editor.tsx';

// A server with a secret the registry declared, a declared variable left unset, and one added by hand.
const { env, envMeta } = stdioServer({
  config: {
    ...stdioServer().config,
    env: { API_KEY: 'super-secret', LOG_LEVEL: 'debug' },
    envMeta: {
      API_KEY: { description: 'The API key', isRequired: true, isSecret: true },
      REGION: { description: 'Deployment region', placeholder: 'eu-west-1' },
    },
  },
}).config;

const meta = {
  component: EnvEditor,
  args: { env, envMeta, onSave: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EnvEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsDeclaredVariablesAsFieldsAndTheRestAsRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText(/^API_KEY/)).toHaveValue('super-secret');
    await expect(canvas.getByLabelText(/^API_KEY/)).toBeRequired();
    await expect(canvas.getByText('The API key')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: /^REGION/ })).toHaveValue('');
    await expect(canvas.getByText('Deployment region')).toBeVisible();
    // A variable nobody declared is a row whose name can be edited too.
    await expect(canvas.getByText('Other variables')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Variable name' })).toHaveValue('LOG_LEVEL');
    await expect(canvas.getByRole('textbox', { name: 'Value for LOG_LEVEL' })).toHaveValue('debug');
  },
};

export const RevealsASecretOnRequest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const secret = canvas.getByLabelText(/^API_KEY/);
    await expect(secret).toHaveAttribute('type', 'password');
    await userEvent.click(canvas.getByRole('button', { name: 'Reveal API_KEY' }));
    await expect(secret).toHaveAttribute('type', 'text');
    await userEvent.click(canvas.getByRole('button', { name: 'Hide API_KEY' }));
    await expect(secret).toHaveAttribute('type', 'password');
  },
};

export const SavesEditedAddedAndDeclaredVariables: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: /^REGION/ }), 'eu-west-1');
    const logLevel = canvas.getByRole('textbox', { name: 'Value for LOG_LEVEL' });
    await userEvent.clear(logLevel);
    await userEvent.type(logLevel, 'info');
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }));
    const [, newName] = canvas.getAllByRole('textbox', { name: 'Variable name' });
    await expect(newName).toBeDefined();
    if (newName) {
      await userEvent.type(newName, 'NEW_VAR');
    }
    await userEvent.type(canvas.getByRole('textbox', { name: 'Value for NEW_VAR' }), 'hello');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(args.onSave).toHaveBeenCalledWith({
        API_KEY: 'super-secret',
        REGION: 'eu-west-1',
        LOG_LEVEL: 'info',
        NEW_VAR: 'hello',
      }),
    );
  },
};

export const DropsRemovedAndEmptiedVariables: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText(/^API_KEY/));
    await userEvent.click(canvas.getByRole('button', { name: 'Remove LOG_LEVEL' }));
    await expect(canvas.queryByRole('textbox', { name: 'Value for LOG_LEVEL' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith({}));
  },
};

export const WithNoVariables: Story = {
  args: { env: {}, envMeta: {} },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No environment variables configured.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }));
    await expect(canvas.queryByText('No environment variables configured.')).not.toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Variable name' }), 'TOKEN');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Value for TOKEN' }), 'abc');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith({ TOKEN: 'abc' }));
  },
};

export const SaveIsOffWhileTheCallerIsSaving: Story = {
  args: { loading: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

export const ShowsProgressUntilTheSaveSettles: Story = {
  args: { onSave: fn(() => new Promise<void>(() => {})) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(await canvas.findByRole('button', { name: /Saving…/ })).toBeDisabled();
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};
