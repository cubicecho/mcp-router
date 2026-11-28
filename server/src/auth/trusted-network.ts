import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { Role, users } from '../db/tables/users.ts';
import type { Auth } from './better-auth.ts';

/** The account a trusted network signs everyone in as. `.invalid` is reserved, so it reaches no inbox. */
export const LOCAL_ADMIN_EMAIL = 'local-admin@mcp-router.invalid';
/** What the account is called in the UI. */
const LOCAL_ADMIN_NAME = 'Local admin';
/** How the account is labelled in better-auth's hooks. */
const LOCAL_NET_METHOD = 'secure-local-net';

/** A session, as the UI keeps it. */
export interface IssuedSession {
  /** Sent back as `Authorization: Bearer`. */
  token: string;
  userId: string;
}

/**
 * Signs whoever opened the UI in as the local admin, on the strength of the network alone.
 *
 * @param db - The database.
 * @param auth - The auth instance, whose adapter makes the account and the session.
 * @returns The session.
 *
 * @remarks
 * The account is made on first use and kept an admin, even after others sign in through OIDC. Only the UI is opened
 * this way: MCP clients and agents still need an API key.
 */
export async function signInLocalAdmin(db: DB, auth: Auth): Promise<IssuedSession> {
  const { internalAdapter } = await auth.$context;
  const existing = await internalAdapter.findUserByEmail(LOCAL_ADMIN_EMAIL);
  const user =
    existing?.user ??
    (await internalAdapter.createUser(
      { email: LOCAL_ADMIN_EMAIL, name: LOCAL_ADMIN_NAME, emailVerified: false },
      { method: LOCAL_NET_METHOD },
    ));
  await db.update(users).set({ role: Role.Admin }).where(eq(users.id, user.id));
  const session = await internalAdapter.createSession(user.id);
  return { token: session.token, userId: user.id };
}
