import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { Role, users } from '../db/tables/users.ts';

/**
 * Makes a new account an admin when the router has none.
 *
 * @param db - The database.
 * @param userId - The account just created.
 *
 * @remarks
 * One statement, so two first sign-ins at once cannot both claim it.
 */
export async function claimFirstAdmin(db: DB, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ role: Role.Admin })
    .where(and(eq(users.id, userId), sql`not exists (select 1 from users where role = ${Role.Admin})`));
}

/**
 * Whether anyone has an account yet.
 *
 * @param db - The database.
 * @returns True once the first account exists.
 */
export async function hasUsers(db: DB): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return row !== undefined;
}
