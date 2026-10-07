/**
 * Aggregate-endpoint namespacing: tools/prompts/resources of downstream
 * servers are exposed as `<server>__<name>`. Splitting matches against the
 * known server names (longest first) because server names may themselves
 * contain underscores.
 */

/** What sits between the server name and the downstream name. */
const NAMESPACE_SEPARATOR = '__';

/**
 * Prefixes a downstream name or URI with its server's name.
 *
 * @param serverName - The server the name belongs to.
 * @param name - The tool name, prompt name or resource URI as the server knows it.
 * @returns `<serverName>__<name>`.
 */
export function namespaceName(serverName: string, name: string): string {
  return `${serverName}${NAMESPACE_SEPARATOR}${name}`;
}

/** A namespaced name taken apart. */
export interface NamespacedName {
  serverName: string;
  /** The name or URI as the server itself knows it. */
  name: string;
}

/**
 * Splits a namespaced name back into its server and the downstream name.
 *
 * @param full - The name as the aggregate exposed it.
 * @param serverNames - The servers it could belong to; the longest matching prefix wins.
 * @returns The two parts, or undefined when no server's prefix matches or nothing follows it.
 */
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
