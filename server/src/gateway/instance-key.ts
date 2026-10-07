/**
 * Identifies one managed instance: a server's global one is keyed by the server
 * name, a workspace member's by {@link workspaceInstanceKey}.
 */
export type InstanceKey = string;

/** Key of a server's instance inside a workspace. Contains ':' so it never collides with a server name. */
export function workspaceInstanceKey(slug: string, serverName: string): InstanceKey {
  return `w:${slug}:${serverName}`;
}

/** True for a workspace member's key (a global key is a plain server name, which cannot contain ':'). */
function isWorkspaceKey(key: InstanceKey): boolean {
  return key.includes(':');
}

/** True for a server's own key, the one its global instance runs under. */
export function isBaseServerKey(key: InstanceKey): boolean {
  return isWorkspaceKey(key) === false;
}
