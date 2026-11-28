import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** What a user may do. Both run the router; only an admin may pair or disconnect its OIDC provider. */
export const Role = { Admin: 'admin', User: 'user' } as const;
export type Role = (typeof Role)[keyof typeof Role];

/** A person who signs in to the router's UI. Owned by better-auth, except for `role`. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    /** Whether the OIDC provider vouched for the address. better-auth reads and writes it. */
    emailVerified: boolean('email_verified').notNull().default(false),
    /** better-auth's column for a picture, from the provider's profile. */
    image: text('image'),
    /** The first user to sign in is made an admin. */
    role: text('role', { enum: [Role.Admin, Role.User] })
      .notNull()
      .default(Role.User),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('uq_users_email').on(table.email),
    check('ck_users_role', sql`${table.role} in ('admin', 'user')`),
  ],
);

/** A user row as read. */
export type User = typeof users.$inferSelect;
/** A user row as inserted. */
export type NewUser = typeof users.$inferInsert;
