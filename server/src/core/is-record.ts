/**
 * Narrows a value to something whose keys can be read as unknown values.
 *
 * @param value - Anything.
 * @returns True for any non-null object, arrays included.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
