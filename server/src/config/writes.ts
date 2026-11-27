// The multi-row writes the store and the first-boot import share. Each runs inside the caller's transaction.
import type { ServerConfig, WorkspaceConfig } from '@mcp-router/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../db/client.ts';
import { servers } from '../db/tables/servers.ts';
import { workspaceMembers } from '../db/tables/workspace-members.ts';
import { workspaces } from '../db/tables/workspaces.ts';
import { memberToRow, serverToRow, workspaceToRow } from './rows.ts';

/**
 * Creates or replaces a server by name. Its id, and so its workspace memberships, survive a replace.
 *
 * @param tx - The transaction.
 * @param config - A validated server config.
 */
export async function upsertServer(tx: Transaction, config: ServerConfig): Promise<void> {
  const values = serverToRow(config);
  await tx
    .insert(servers)
    .values(values)
    .onConflictDoUpdate({ target: servers.name, set: { ...values, updatedAt: new Date() } });
}

/**
 * Creates or replaces a workspace by slug, with exactly the members it names.
 *
 * @param tx - The transaction.
 * @param config - A validated workspace config.
 *
 * @remarks
 * A membership points at a server row, so a member naming no existing server cannot be stored: it is skipped with a
 * logged warning.
 */
export async function upsertWorkspace(tx: Transaction, config: WorkspaceConfig): Promise<void> {
  const values = workspaceToRow(config);
  const [stored] = await tx
    .insert(workspaces)
    .values(values)
    .onConflictDoUpdate({ target: workspaces.slug, set: { ...values, updatedAt: new Date() } })
    .returning({ id: workspaces.id });
  if (stored === undefined) {
    throw new Error(`Saving workspace "${config.slug}" returned no row`);
  }
  await tx.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, stored.id));
  const names = Object.keys(config.members);
  if (names.length === 0) {
    return;
  }
  const found = await tx
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .where(inArray(servers.name, names));
  const idByName = new Map(found.map((server) => [server.name, server.id]));
  const missing = names.filter((name) => idByName.has(name) === false);
  for (const name of missing) {
    console.warn(
      `[db] workspace "${config.slug}" names server "${name}", which does not exist; that member was not stored`,
    );
  }
  const rows = Object.entries(config.members).flatMap(([name, member]) => {
    const serverId = idByName.get(name);
    return serverId === undefined ? [] : [{ ...memberToRow(member), workspaceId: stored.id, serverId }];
  });
  if (rows.length > 0) {
    await tx.insert(workspaceMembers).values(rows);
  }
}
