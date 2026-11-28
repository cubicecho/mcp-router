import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** A custom aggregate exposing a chosen subset of servers at /mcp/w/<slug>. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Display name. */
    name: text('name').notNull(),
    /** The route segment at /mcp/w/<slug>; `serverNameSchema` rules. */
    slug: text('slug').notNull(),
    /** Off 404s the endpoint without deleting the workspace. */
    enabled: boolean('enabled').notNull().default(true),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_workspaces_slug').on(table.slug)],
);

/** A workspace row as read. */
export type WorkspaceRow = typeof workspaces.$inferSelect;
