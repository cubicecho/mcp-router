import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { servers } from './servers.ts';
import { workspaces } from './workspaces.ts';

/**
 * A server's place in a workspace, with its per-workspace overrides. `env` and `headers` merge over the
 * server's own; `args` and `url` replace them. Deleting either side deletes the membership.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    serverId: uuid('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    /** Include the server in the workspace's aggregate. */
    enabled: boolean('enabled').notNull().default(true),
    /** Env vars merged over the server's (stdio). Null keeps the server's. */
    env: jsonb('env').$type<Record<string, string>>(),
    /** Replaces the server's stdio args. Null keeps them. */
    args: jsonb('args').$type<string[]>(),
    /** Headers merged over the server's (streamable HTTP). Null keeps them. */
    headers: jsonb('headers').$type<Record<string, string>>(),
    /** Replaces the server's streamable-HTTP URL. Null keeps it. */
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_workspace_members_workspace_id_server_id').on(table.workspaceId, table.serverId),
    index('idx_workspace_members_server_id').on(table.serverId),
  ],
);

/** A membership row as read. */
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
