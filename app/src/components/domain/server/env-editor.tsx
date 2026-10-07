import type { EnvVarMeta } from '@mcp-router/shared';
import { InputField, useAppForm } from '@/components/app-form';
import { KeyValueRows } from '@/components/domain/key-value-rows';
import { EmptyState } from '@/components/page';
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
 * Form over a server's env vars. The ones the registry declared (`envMeta`) are
 * fixed fields — named, described, masked with a reveal toggle when secret —
 * and everything else in `env` is a free key/value row that can be renamed,
 * added and removed. Save emits the resulting env record (entries with an empty
 * key or value are dropped).
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

      <form.Field name="extraRows">
        {(field) => (
          <>
            {declared.length === 0 && field.state.value.length === 0 && (
              <EmptyState compact title="No environment variables configured." />
            )}
            <KeyValueRows
              legend={declared.length > 0 ? 'Other variables' : 'Variables'}
              hideLegendWhenEmpty
              keyLabel="Variable name"
              unnamed="new variable"
              addLabel="Add variable"
              value={field.state.value}
              onValueChange={field.handleChange}
            />
          </>
        )}
      </form.Field>

      <div className="flex justify-end">
        <form.AppForm>
          <form.SubmitButton size="sm" disabled={loading} />
        </form.AppForm>
      </div>
    </form>
  );
}
