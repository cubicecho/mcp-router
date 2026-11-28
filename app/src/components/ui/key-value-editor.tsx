import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PasswordInput } from '@/components/password-input';
import { Button } from '@/components/ui/button';
import { Plus, X } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import type { KeyValueRow } from '@/lib/key-value';
import { cn } from '@/lib/utils';

export type KeyValueEditorProps = {
  /** The rows, in the order they are drawn. A row has no identity beyond its place. */
  value: readonly KeyValueRow[];
  /** Called with the whole new list on every keystroke, add and remove. */
  onValueChange: (value: KeyValueRow[]) => void;
  /**
   * What the name column is: "Name", "Variable". Each name box's placeholder, and with the row's
   * place its accessible name, "Name 2".
   */
  keyLabel: string;
  /** What the value column is: "Value". Each value box's placeholder, and "Value 2". */
  valueLabel: string;
  /** The add button's words: "Add header", "Add variable". */
  addLabel: string;
  /**
   * The start of each row's remove button's name, which ends in the row's place: "Remove row 2".
   * The default is "Remove row"; pass the app's own words or translation.
   */
  removeLabel?: string | undefined;
  /**
   * Draw the values masked, each with a button that shows it — for secrets such as an
   * `Authorization` header. The names are never masked.
   */
  masked?: boolean | undefined;
  /** What the editor says with no rows: "No headers". Left out, only the add button is drawn. */
  emptyTitle?: string | undefined;
  /** Every box and button is drawn and none can be changed or pressed. */
  disabled?: boolean | undefined;
  /** Called when a box loses focus, which is what marks a form field touched. */
  onBlur?: (() => void) | undefined;
  /** The group's id. A bound field hands it down. */
  id?: string | undefined;
  /** The group's name, when no visible label names it: "Headers". */
  'aria-label'?: string | undefined;
  /** The id of the visible label that names the group, in place of `aria-label`. */
  'aria-labelledby'?: string | undefined;
  /** The id of the line that describes the group, and of its error. */
  'aria-describedby'?: string | undefined;
  /** Whether the rows as a whole were refused, such as for a name used twice. */
  'aria-invalid'?: boolean | 'true' | 'false' | undefined;
  /** On the group, the column the rows and the add button stand in. */
  className?: string | undefined;
};

/** Each box's share of a row: the two split it, until 10rem each no longer fits and they stack. */
const BOX = 'min-w-40 flex-1';

/** Name and value pairs as rows of two boxes, each removable, with a button that adds one. */
export function KeyValueEditor({
  value,
  onValueChange,
  keyLabel,
  valueLabel,
  addLabel,
  removeLabel = 'Remove row',
  masked = false,
  emptyTitle,
  disabled = false,
  onBlur,
  className,
  ...group
}: KeyValueEditorProps) {
  // The row just added, whose name box takes focus as it mounts. Not set on the first render, so
  // a form opening onto existing rows does not open the keyboard.
  const [added, setAdded] = useState<number | null>(null);
  const ValueBox = masked ? PasswordInput : Input;

  const patch = (index: number, next: Partial<KeyValueRow>) =>
    onValueChange(value.map((row, at) => (at === index ? { ...row, ...next } : row)));

  return (
    <div
      data-slot="key-value-editor"
      // Hand-written rather than a `<fieldset>`, which has no native counterpart, as `Field`'s is.
      role="group"
      {...(group as React.ComponentPropsWithoutRef<'div'>)}
      className={cn('cube-rn-view', 'min-w-0 gap-3', className)}
    >
      {value.length === 0 && emptyTitle !== undefined ? <EmptyState compact title={emptyTitle} /> : null}
      {value.map((row, index) => {
        const place = index + 1;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a row has no identity beyond its place.
            key={index}
            data-slot="key-value-row"
            className="cube-rn-view min-w-0 flex-row items-start gap-2"
          >
            <div className="cube-rn-view min-w-0 flex-1 flex-row flex-wrap gap-2">
              <div className={cn('cube-rn-view', BOX)}>
                <Input
                  value={row.key}
                  onChangeText={(key) => patch(index, { key })}
                  onBlur={onBlur}
                  placeholder={keyLabel}
                  aria-label={`${keyLabel} ${place}`}
                  autoFocus={added === index}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disabled={disabled}
                  className="font-mono"
                />
              </div>
              <div className={cn('cube-rn-view', BOX)}>
                <ValueBox
                  value={row.value}
                  onChangeText={(text) => patch(index, { value: text })}
                  onBlur={onBlur}
                  placeholder={valueLabel}
                  aria-label={`${valueLabel} ${place}`}
                  {...(masked
                    ? {
                        showLabel: `Show ${valueLabel} ${place}`,
                        hideLabel: `Hide ${valueLabel} ${place}`,
                      }
                    : {})}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disabled={disabled}
                  className="font-mono"
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label={`${removeLabel} ${place}`}
              disabled={disabled}
              onClick={() => {
                setAdded(null);
                onValueChange(value.filter((_row, at) => at !== index));
              }}
              iconSlot={<X />}
            />
          </div>
        );
      })}
      <Button
        variant="info"
        size="sm"
        iconSlot={<Plus />}
        content={addLabel}
        disabled={disabled}
        onClick={() => {
          setAdded(value.length);
          onValueChange([...value, { key: '', value: '' }]);
        }}
        className="self-start"
      />
    </div>
  );
}

export type { KeyValueRow };
