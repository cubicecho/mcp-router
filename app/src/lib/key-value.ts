export interface KeyValueRow {
  key: string;
  value: string;
}

export const recordToRows = (record: Record<string, string>): KeyValueRow[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }));

/** Rows with a (trimmed) key, as a record. Pass `skipEmptyValues` to also drop rows with no value. */
export function rowsToRecord(rows: KeyValueRow[], { skipEmptyValues = false } = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() && (row.value || !skipEmptyValues)) {
      result[row.key.trim()] = row.value;
    }
  }
  return result;
}
