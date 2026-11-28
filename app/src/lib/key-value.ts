export type KeyValueRow = { key: string; value: string };

/** Why a line is not a pair. */
export type KeyValueLineProblem = 'no-separator' | 'blank-name' | 'duplicate-name';

/** A line `parseKeyValueLines` left out, and why. */
export type KeyValueLineError = {
  /** The line's number, counting from 1, as an editor's gutter does. */
  line: number;
  problem: KeyValueLineProblem;
  /** The reason in a sentence, for a field's error: `Line 3 has no ":" in it.` */
  message: string;
};

/** What reading `Name: value` lines found: the pairs, and every line that was not one. */
export type ParsedKeyValueLines = {
  record: Record<string, string>;
  /** Empty when every line that is not blank was a pair. */
  errors: KeyValueLineError[];
};

/** The character between a name and its value. */
const SEPARATOR = ':';

/** The reason each problem gives, for its line. */
const MESSAGES = {
  'no-separator': (line: number) => `Line ${line} has no "${SEPARATOR}" in it.`,
  'blank-name': (line: number) => `Line ${line} has no name before the "${SEPARATOR}".`,
  'duplicate-name': (line: number, name: string) => `Line ${line} names "${name}" again; each name may be used once.`,
} satisfies Record<KeyValueLineProblem, (line: number, name: string) => string>;

/**
 * Reads `Name: value` lines into a record.
 *
 * Each line splits at its first `:`, so a value may hold more of them (`Authorization: Basic a:b`,
 * a URL). The name and the value are trimmed. Blank lines are skipped. A line with no `:`, a line
 * with nothing before it, and a name already used are errors, and are left out of the record —
 * a repeated name keeps its first value, the one the reader sees first.
 *
 * @param text - The textarea's text.
 * @returns The record built from the lines that were pairs, and an error for each that was not.
 */
export function parseKeyValueLines(text: string): ParsedKeyValueLines {
  const record: Record<string, string> = {};
  const errors: KeyValueLineError[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    if (raw.trim() === '') {
      continue;
    }
    const at = raw.indexOf(SEPARATOR);
    if (at === -1) {
      errors.push({ line, problem: 'no-separator', message: MESSAGES['no-separator'](line) });
      continue;
    }
    const name = raw.slice(0, at).trim();
    if (name === '') {
      errors.push({ line, problem: 'blank-name', message: MESSAGES['blank-name'](line) });
      continue;
    }
    if (Object.hasOwn(record, name)) {
      errors.push({
        line,
        problem: 'duplicate-name',
        message: MESSAGES['duplicate-name'](line, name),
      });
      continue;
    }
    record[name] = raw.slice(at + 1).trim();
  }
  return { record, errors };
}

/**
 * Writes a record as `Name: value` lines, in the record's order — what a textarea starts from.
 *
 * @param record - The pairs.
 * @returns One line per pair, with no line after the last.
 */
export function formatKeyValueLines(record: Readonly<Record<string, string>>): string {
  return Object.entries(record)
    .map(([name, value]) => `${name}${SEPARATOR} ${value}`)
    .join('\n');
}

/**
 * Turns a record into a `KeyValueEditor`'s rows.
 *
 * @param record - The pairs, such as a server's environment.
 * @returns One row per pair, in the record's order.
 */
export function recordToRows(record: Readonly<Record<string, string>>): KeyValueRow[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

/**
 * Turns a `KeyValueEditor`'s rows back into a record, for a save.
 *
 * A row whose name is blank is dropped, which is the row added and never filled in. Names are
 * trimmed; of two rows with one name the later wins, since the editor shows both and the later is
 * the one typed last. Check for that before saving if it matters (`duplicateKeys`).
 *
 * @param rows - The rows as typed.
 * @param options - `skipEmptyValues` also drops a row with no value, for an environment where an
 *   empty variable means "not set".
 * @returns The record.
 */
export function rowsToRecord(
  rows: readonly KeyValueRow[],
  { skipEmptyValues = false }: { skipEmptyValues?: boolean | undefined } = {},
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '' || (skipEmptyValues && row.value === '')) {
      continue;
    }
    record[key] = row.value;
  }
  return record;
}

/**
 * The names used by more than one row, for a validator: two `Authorization` rows are one header
 * the server will see once.
 *
 * @param rows - The rows as typed.
 * @returns Each repeated name once, trimmed, in the order it first repeats.
 */
export function duplicateKeys(rows: readonly KeyValueRow[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '') {
      continue;
    }
    if (seen.has(key)) {
      repeated.add(key);
    }
    seen.add(key);
  }
  return [...repeated];
}
