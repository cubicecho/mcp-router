import { bindToForm, type FieldProps, splitProps, useFieldContext, useFieldError } from '@/components/app-form';
import { FormField } from '@/components/form-field';
import { KeyValueEditor, type KeyValueEditorProps } from '@/components/ui/key-value-editor';
import type { KeyValueRow } from '@/lib/key-value';

type KeyValueFieldProps = FieldProps &
  Omit<
    KeyValueEditorProps,
    | 'value'
    | 'onValueChange'
    | 'onBlur'
    | 'id'
    | 'aria-label'
    | 'aria-labelledby'
    | 'aria-describedby'
    | 'aria-invalid'
    | 'disabled'
  >;

/**
 * cubeui's `KeyValueEditor` inside a `FormField`, reading and writing the bound field's rows.
 *
 * @param props - The field's label, description and the like, and the editor's own labels.
 * @returns The labelled group of rows with its add button.
 *
 * @remarks
 * cubeui's own `KeyValueField` binds through `@cubeui/form`; this app's forms are `@cubeui/app-form`, so the editor
 * is bound here with `bindToForm`, as the registry says a field it does not ship should be.
 */
function BoundKeyValueField(props: KeyValueFieldProps) {
  const [fieldProps, editor] = splitProps(props);
  const field = useFieldContext<KeyValueRow[]>();
  const error = useFieldError();

  return (
    <FormField
      {...fieldProps}
      asGroup
      error={error}
      controlSlot={(control) => (
        <KeyValueEditor
          {...editor}
          {...control}
          value={field.state.value}
          onValueChange={(rows) => field.handleChange(rows)}
          onBlur={field.handleBlur}
        />
      )}
    />
  );
}

/**
 * Name and value rows (environment variables, headers) bound to a form field holding `KeyValueRow[]`.
 *
 * ```tsx
 * <KeyValueField form={form} name="envRows" label="Environment variables" keyLabel="Name" valueLabel="Value" addLabel="Add variable" />
 * ```
 */
export const KeyValueField = bindToForm<KeyValueFieldProps, KeyValueRow[]>(BoundKeyValueField, 'KeyValueField');
