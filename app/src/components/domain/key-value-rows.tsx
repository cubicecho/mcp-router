import { ActionButton } from '@/components/action-button';
import { Button } from '@/components/ui/button';
import { Plus, X } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { KeyValueRow } from '@/lib/key-value';

interface KeyValueRowsProps {
  legend: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder?: string;
  /** Accessible name of each key input. */
  keyLabel: string;
  /** What an unnamed row is called in its value/remove labels, e.g. "new variable". */
  unnamed: string;
  addLabel: string;
  /** Hide the legend while there are no rows. */
  hideLegendWhenEmpty?: boolean;
}

/** Editable list of key/value pairs (env vars, headers), held by the caller — typically one form field. */
export function KeyValueRows({
  legend,
  rows,
  onChange,
  keyPlaceholder = 'KEY',
  keyLabel,
  unnamed,
  addLabel,
  hideLegendWhenEmpty = false,
}: KeyValueRowsProps) {
  const patch = (index: number, next: Partial<KeyValueRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className="flex flex-col gap-2">
      {(rows.length > 0 || !hideLegendWhenEmpty) && <Label>{legend}</Label>}
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position
        <div key={index} className="flex items-center gap-2">
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={keyLabel}
            className="w-2/5 font-mono"
            onChange={(event) => patch(index, { key: event.target.value })}
          />
          <Input
            value={row.value}
            placeholder="value"
            aria-label={`Value for ${row.key || unnamed}`}
            className="flex-1 font-mono"
            onChange={(event) => patch(index, { value: event.target.value })}
          />
          <ActionButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label={`Remove ${row.key || unnamed}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            iconSlot={<X />}
          />
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
          iconSlot={<Plus />}
          content={addLabel}
        />
      </div>
    </div>
  );
}
