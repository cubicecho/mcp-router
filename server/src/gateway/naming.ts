/**
 * Aggregate-endpoint namespacing: tools/prompts/resources of downstream
 * servers are exposed as `<server>__<name>`. Splitting matches against the
 * known server names (longest first) because server names may themselves
 * contain underscores.
 */

export const NAMESPACE_SEPARATOR = '__';

export function namespaceName(serverName: string, name: string): string {
  return `${serverName}${NAMESPACE_SEPARATOR}${name}`;
}

export interface NamespacedName {
  serverName: string;
  name: string;
}

export function splitNamespacedName(full: string, serverNames: readonly string[]): NamespacedName | undefined {
  const byLengthDesc = [...serverNames].sort((a, b) => b.length - a.length);
  for (const serverName of byLengthDesc) {
    if (full.startsWith(serverName + NAMESPACE_SEPARATOR)) {
      const name = full.slice(serverName.length + NAMESPACE_SEPARATOR.length);
      if (name.length > 0) {
        return { serverName, name };
      }
    }
  }
  return undefined;
}
