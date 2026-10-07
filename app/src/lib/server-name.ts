import { serverNameSchema } from '@mcp-router/shared';

/**
 * Picks what to call a server on screen.
 *
 * @param name - The server's name.
 * @param [displayName] - Its display name, if it has one.
 * @returns The display name, or the name when there is none.
 *
 * @remarks
 * An empty display name counts as none, so a server never shows as a blank label.
 */
export function serverLabel(name: string, displayName?: string): string {
  return displayName || name;
}

/**
 * Says why a value cannot be a server name.
 *
 * @param value - The name as typed.
 * @param [options] - How to treat special values.
 * @param [options.allowEmpty] - Treat an empty value as "nothing typed yet" rather than an error, for a field whose
 * form blocks submitting some other way.
 * @returns The first validation message, or undefined when the name is valid.
 */
export function serverNameError(value: string, { allowEmpty = false } = {}): string | undefined {
  if (allowEmpty && !value) {
    return undefined;
  }
  const result = serverNameSchema.safeParse(value);
  return result.success ? undefined : (result.error.issues[0]?.message ?? 'Invalid name');
}
