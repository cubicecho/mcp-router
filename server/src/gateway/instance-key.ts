/**
 * Identifies one managed instance: a server's global one is keyed by the server name, a workspace member's by
 * {@link workspaceInstanceKey}.
 */
export type InstanceKey = string;

/**
 * Builds the key of a server's instance inside a workspace.
 *
 * @param slug - The workspace's slug.
 * @param serverName - The member's server name.
 * @returns `w:<slug>:<serverName>`; the ':' means it never collides with a server name.
 */
export function workspaceInstanceKey(slug: string, serverName: string): InstanceKey {
  return `w:${slug}:${serverName}`;
}

/**
 * Tells a workspace member's key from a global one.
 *
 * @param key - Any instance key.
 * @returns True when it contains ':', which a global key (a plain server name) cannot.
 */
function isWorkspaceKey(key: InstanceKey): boolean {
  return key.includes(':');
}

/**
 * Tells whether a key is a server's own, the one its global instance runs under.
 *
 * @param key - Any instance key.
 * @returns True when it is not a workspace member's key.
 */
export function isBaseServerKey(key: InstanceKey): boolean {
  return isWorkspaceKey(key) === false;
}
