import { serverNameSchema } from '@mcp-router/shared';

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
