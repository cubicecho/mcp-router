import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** A registry the router can browse and install from. */
export const registries = pgTable(
  'registries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unique short name, e.g. "official". Install sources refer to a registry by it. */
    name: text('name').notNull(),
    /** Base URL of an MCP-registry-API-compatible service. */
    url: text('url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_registries_name').on(table.name)],
);

/** A registry row as read. */
export type RegistryRow = typeof registries.$inferSelect;
