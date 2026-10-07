import { serverNameSchema } from '@mcp-router/shared';

/**
 * What to call a server on screen: its display name, or its name when it has none. An empty
 * display name counts as none, so a server never shows as a blank label.
 */
export function serverLabel(name: string, displayName?: string): string {
  return displayName || name;
}

/**
 * Why a value cannot be a server name, or undefined when it can.
 *
 * @param allowEmpty - Treat an empty value as "nothing typed yet" rather than an error, for a field
 *   whose form blocks submitting some other way.
 */
export function serverNameError(value: string, { allowEmpty = false } = {}): string | undefined {
  if (allowEmpty && !value) {
    return undefined;
  }
  const result = serverNameSchema.safeParse(value);
  return result.success ? undefined : (result.error.issues[0]?.message ?? 'Invalid name');
}
