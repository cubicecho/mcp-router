// Maps the config shapes `@mcp-router/shared` describes to table rows and back. Reads are validated with the same
// zod schemas the files used, so a row written by hand or by a later GraphQL mutation is checked like a file was.
import {
  type Registry,
  registrySchema,
  type ServerConfig,
  type SettingsFile,
  serverConfigSchema,
  settingsFileSchema,
  type WorkspaceConfig,
  type WorkspaceMember,
  workspaceConfigSchema,
} from '@mcp-router/shared';
import type { RegistryRow, registries } from '../db/tables/registries.ts';
import type { ServerRow, servers } from '../db/tables/servers.ts';
import type { SettingsRow, settings } from '../db/tables/settings.ts';
import type { WorkspaceMemberRow, workspaceMembers } from '../db/tables/workspace-members.ts';
import type { WorkspaceRow, workspaces } from '../db/tables/workspaces.ts';

/** The columns a settings write sets: every one but the id and the timestamps. */
export type SettingsValues = Omit<typeof settings.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
/** The columns a registry write sets. */
export type RegistryValues = Omit<typeof registries.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
/** The columns a server write sets. */
export type ServerValues = Omit<typeof servers.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
/** The columns a workspace write sets. */
export type WorkspaceValues = Omit<typeof workspaces.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
/** The columns a membership write sets, apart from which workspace and server it joins. */
export type MemberValues = Omit<
  typeof workspaceMembers.$inferInsert,
  'id' | 'workspaceId' | 'serverId' | 'createdAt' | 'updatedAt'
>;

/** A membership as read, with the name of the server it points at. */
export interface NamedMemberRow {
  serverName: string;
  member: WorkspaceMemberRow;
}

/**
 * Drops the null columns, which the schemas spell as an absent key.
 *
 * @param row - The columns to keep.
 * @returns A copy without the null values.
 */
function withoutNulls(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

/**
 * Reads the settings row.
 *
 * @param row - The settings row.
 * @returns The settings. Throws when the row fails `settingsFileSchema`.
 */
export function settingsFromRow(row: SettingsRow): SettingsFile {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...columns } = row;
  return settingsFileSchema.parse(withoutNulls(columns));
}

/**
 * Writes settings as the settings row's columns.
 *
 * @param value - Validated settings.
 * @returns The columns, null for each absent optional key.
 */
export function settingsToRow(value: SettingsFile): SettingsValues {
  return {
    port: value.port,
    authToken: value.authToken,
    authEnabled: value.authEnabled,
    host: value.host ?? null,
    allowedOrigins: value.allowedOrigins,
    idleTimeoutMs: value.idleTimeoutMs,
    sessionIdleTimeoutMs: value.sessionIdleTimeoutMs,
    maxSessions: value.maxSessions,
    connectTimeoutMs: value.connectTimeoutMs,
    callTimeoutMs: value.callTimeoutMs,
    publicUrl: value.publicUrl ?? null,
    instanceId: value.instanceId ?? null,
    lanAdvertise: value.lanAdvertise,
    lanDiscovery: value.lanDiscovery,
    lanDismissed: value.lanDismissed,
  };
}

/**
 * Reads a registry row.
 *
 * @param row - The registry row.
 * @returns The registry. Throws when the row fails `registrySchema`.
 */
export function registryFromRow(row: RegistryRow): Registry {
  return registrySchema.parse({ name: row.name, url: row.url });
}

/**
 * Writes a registry as a row's columns.
 *
 * @param value - A validated registry.
 * @returns The columns.
 */
export function registryToRow(value: Registry): RegistryValues {
  return { name: value.name, url: value.url };
}

/**
 * Reads a server row.
 *
 * @param row - The server row.
 * @returns The server's config. Throws when the row fails `serverConfigSchema`.
 */
export function serverFromRow(row: ServerRow): ServerConfig {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...columns } = row;
  return serverConfigSchema.parse(withoutNulls(columns));
}

/**
 * Writes a server's config as a row's columns.
 *
 * @param value - A validated server config.
 * @returns The columns, null for each absent optional key.
 */
export function serverToRow(value: ServerConfig): ServerValues {
  return {
    name: value.name,
    displayName: value.displayName ?? null,
    description: value.description ?? null,
    enabled: value.enabled,
    source: value.source,
    transport: value.transport,
    env: value.env,
    envMeta: value.envMeta,
    idleTimeoutMs: value.idleTimeoutMs ?? null,
    callTimeoutMs: value.callTimeoutMs ?? null,
    oauth: value.oauth ?? null,
    discovered: value.discovered ?? null,
  };
}

/**
 * Reads a workspace row and its memberships.
 *
 * @param row - The workspace row.
 * @param members - Its memberships, each with its server's name.
 * @returns The workspace's config, members keyed by server name. Throws when it fails `workspaceConfigSchema`.
 */
export function workspaceFromRows(row: WorkspaceRow, members: NamedMemberRow[]): WorkspaceConfig {
  const entries = members.map(({ serverName, member }) => {
    const { id: _id, workspaceId: _w, serverId: _s, createdAt: _c, updatedAt: _u, ...columns } = member;
    return [serverName, withoutNulls(columns)] as const;
  });
  return workspaceConfigSchema.parse({
    name: row.name,
    slug: row.slug,
    enabled: row.enabled,
    ...(row.description === null ? {} : { description: row.description }),
    members: Object.fromEntries(entries),
  });
}

/**
 * Writes a workspace's own fields as a row's columns. Its members are rows of their own.
 *
 * @param value - A validated workspace config.
 * @returns The columns.
 */
export function workspaceToRow(value: WorkspaceConfig): WorkspaceValues {
  return { name: value.name, slug: value.slug, enabled: value.enabled, description: value.description ?? null };
}

/**
 * Writes one member's overrides as a membership row's columns.
 *
 * @param value - A validated member.
 * @returns The columns, null for each override left out.
 */
export function memberToRow(value: WorkspaceMember): MemberValues {
  return {
    enabled: value.enabled,
    env: value.env ?? null,
    args: value.args ?? null,
    headers: value.headers ?? null,
    url: value.url ?? null,
  };
}
