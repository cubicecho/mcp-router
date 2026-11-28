import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/** A signed-in browser. Owned by better-auth: a row is a live session, and deleting it signs that browser out. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What the client sends back as `Authorization: Bearer`. */
    token: text('token').notNull().unique('uq_sessions_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_sessions_user_id').on(table.userId)],
);

/** A session row as read. */
export type Session = typeof sessions.$inferSelect;
/** A session row as inserted. */
export type NewSession = typeof sessions.$inferInsert;
