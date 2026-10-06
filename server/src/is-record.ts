/** True for any non-null object, so its keys can be read as unknown values. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
