/** One row of a key/value editor, as typed. */
export interface KeyValueRow {
  key: string;
  value: string;
}

/**
 * Turns a record into editor rows.
 *
 * @param record - E.g. a server's env.
 * @returns One row per entry, in the record's order.
 */
export const recordToRows = (record: Record<string, string>): KeyValueRow[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }));

/**
 * Turns editor rows back into a record.
 *
 * @param rows - The rows as typed; a row whose key is blank is dropped.
 * @param [options] - How strict to be about values.
 * @param [options.skipEmptyValues] - Also drop rows with no value.
 * @returns The record, keys trimmed; of two rows with the same key the later wins.
 */
export function rowsToRecord(rows: KeyValueRow[], { skipEmptyValues = false } = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() && (row.value || !skipEmptyValues)) {
      result[row.key.trim()] = row.value;
    }
  }
  return result;
}
