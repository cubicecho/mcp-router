import type { ServerConfig, WorkspaceConfig } from '@mcp-router/shared';

/** The slice of ConfigStore these helpers need: is this base server still installed? */
export interface ServerLookup {
  getServer(name: string): ServerConfig | undefined;
}

/**
 * The members a workspace aggregate exposes: enabled ones whose base server
 * still exists, sorted. A member entry outlives a deleted server (the workspace
 * file keeps it), so existence is re-checked against the store every time
 * rather than trusted from the config.
 */
export function enabledMembers(workspace: WorkspaceConfig, servers: ServerLookup): string[] {
  return Object.entries(workspace.members)
    .filter(([name, member]) => (member.enabled ?? true) && servers.getServer(name))
    .map(([name]) => name)
    .sort();
}

/** All members whose base server still exists (enabled or not), sorted — used for activity history. */
export function existingMembers(workspace: WorkspaceConfig, servers: ServerLookup): string[] {
  return Object.keys(workspace.members)
    .filter((name) => servers.getServer(name))
    .sort();
}
