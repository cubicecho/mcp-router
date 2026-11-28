import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** A pending proof: an OIDC sign-in's state, or the hash of a one-time token, until it is spent or expires. Owned by better-auth. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** What is being proved: the token's hash for a one-time token. */
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_verifications_identifier').on(table.identifier)],
);

/** A verification row as read. */
export type Verification = typeof verifications.$inferSelect;
/** A verification row as inserted. */
export type NewVerification = typeof verifications.$inferInsert;
