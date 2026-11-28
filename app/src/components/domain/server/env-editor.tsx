import type { EnvVarMeta } from '@mcp-router/shared';
import { InputField, useAppForm } from '@/components/app-form';
import { KeyValueField } from '@/components/domain/key-value/key-value-field';
import { PasswordField } from '@/components/password-field';
import { recordToRows, rowsToRecord } from '@/lib/key-value';

interface EnvEditorProps {
  env: Record<string, string>;
  envMeta: Record<string, EnvVarMeta>;
  /** A returned promise keeps Save showing progress until it settles. */
  onSave: (env: Record<string, string>) => void | Promise<void>;
  /** The save is still running, when `onSave` returns nothing to wait on. */
  loading?: boolean;
}

/**
 * Form over a server's env vars.
 *
 * @param props.env - The current values, by variable name.
 * @param props.envMeta - The variables the registry declared, by name; each is a fixed, described field.
 * @param props.onSave - Called with the whole env record; a returned promise keeps Save showing progress.
 * @param [props.loading] - Disables Save while a save runs that `onSave` returns nothing to wait on.
 * @returns The form.
 *
 * @remarks
 * Declared variables are masked with a reveal toggle when secret; everything else in `env` is a free row that can be
 * renamed, added and removed. Entries with an empty key or value are dropped on save.
 */
export function EnvEditor({ env, envMeta, onSave, loading = false }: EnvEditorProps) {
  const declared = Object.entries(envMeta);

  const form = useAppForm({
    defaultValues: {
      // An array, not a record keyed by variable name: a name is free text, and a dot in it would read as a path.
      declared: declared.map(([name]) => ({ key: name, value: env[name] ?? '' })),
      extraRows: recordToRows(
        Object.fromEntries(Object.entries(env).filter(([name]) => Object.hasOwn(envMeta, name) === false)),
      ),
    },
    onSubmit: async ({ value }) => {
      await onSave(rowsToRecord([...value.declared, ...value.extraRows], { skipEmptyValues: true }));
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      {declared.map(([name, meta], index) =>
        meta.isSecret ? (
          <PasswordField
            key={name}
            form={form}
            name={`declared[${index}].value`}
            label={name}
            required={meta.isRequired}
            description={meta.description}
            placeholder={meta.placeholder ?? meta.default ?? 'value'}
            showLabel={`Reveal ${name}`}
            hideLabel={`Hide ${name}`}
            // The name and the value are code; the description under them is prose.
            className="font-mono"
            descriptionClassName="font-sans"
          />
        ) : (
          <InputField
            key={name}
            form={form}
            name={`declared[${index}].value`}
            label={name}
            required={meta.isRequired}
            description={meta.description}
            placeholder={meta.placeholder ?? meta.default ?? 'value'}
            className="font-mono"
            descriptionClassName="font-sans"
          />
        ),
      )}

      <KeyValueField
        form={form}
        name="extraRows"
        label={declared.length > 0 ? 'Other variables' : 'Variables'}
        keyLabel="Variable"
        valueLabel="Value"
        addLabel="Add variable"
        emptyTitle={declared.length > 0 ? undefined : 'No environment variables configured.'}
      />

      <div className="flex justify-end">
        <form.AppForm>
          <form.SubmitButton size="sm" disabled={loading} />
        </form.AppForm>
      </div>
    </form>
  );
}
