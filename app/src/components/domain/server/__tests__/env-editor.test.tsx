import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EnvEditor } from '@/components/domain/server/env-editor';

const ENV = { API_KEY: 'super-secret', LOG_LEVEL: 'debug' };
const ENV_META = {
  API_KEY: { description: 'The API key', isRequired: true, isSecret: true },
  REGION: { description: 'Deployment region', isSecret: false },
};

describe('EnvEditor', () => {
  it('renders the union of envMeta and env keys', () => {
    render(<EnvEditor env={ENV} envMeta={ENV_META} onSave={vi.fn()} />);

    expect(screen.getByText('API_KEY')).toBeInTheDocument();
    expect(screen.getByText('REGION')).toBeInTheDocument();
    expect(screen.getByText('LOG_LEVEL')).toBeInTheDocument();
    expect(screen.getByText('The API key')).toBeInTheDocument();
  });

  it('masks secret values and reveals them on toggle', async () => {
    const user = userEvent.setup();
    render(<EnvEditor env={ENV} envMeta={ENV_META} onSave={vi.fn()} />);

    const secretInput = screen.getByLabelText('Value for API_KEY');
    expect(secretInput).toHaveAttribute('type', 'password');
    // non-secret values are plain text
    expect(screen.getByLabelText('Value for LOG_LEVEL')).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Reveal API_KEY' }));
    expect(secretInput).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide API_KEY' }));
    expect(secretInput).toHaveAttribute('type', 'password');
  });

  it('supports editing, adding, and removing vars and emits the right env on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EnvEditor env={ENV} envMeta={ENV_META} onSave={onSave} />);

    // edit an existing value
    const logLevel = screen.getByLabelText('Value for LOG_LEVEL');
    await user.clear(logLevel);
    await user.type(logLevel, 'info');

    // add a new arbitrary var
    await user.click(screen.getByRole('button', { name: /add variable/i }));
    await user.type(screen.getByLabelText('Variable name'), 'NEW_VAR');
    await user.type(screen.getByLabelText('Value for NEW_VAR'), 'hello');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ API_KEY: 'super-secret', LOG_LEVEL: 'info', NEW_VAR: 'hello' });

    // remove the env-only var (meta rows are not removable)
    await user.click(screen.getByRole('button', { name: 'Remove LOG_LEVEL' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenLastCalledWith({ API_KEY: 'super-secret', NEW_VAR: 'hello' });
  });

  it('drops rows with an empty value (unset)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EnvEditor env={ENV} envMeta={ENV_META} onSave={onSave} />);

    await user.clear(screen.getByLabelText('Value for API_KEY'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ LOG_LEVEL: 'debug' });
  });
});
