// Credentials for tests: the real better-auth over the test database, with no provider. A test signs the operator in
// or mints an API key the way the router does, and sends it as it would.
import type { DB } from '../../db/client.ts';
import { type AuthHost, createAuthHost } from '../auth-host.ts';
import { createKey } from '../keys.ts';
import { signInLocalAdmin } from '../trusted-network.ts';

/** The address every test router is at. */
export const TEST_ROUTER_URL = 'http://localhost:3000';

/** What test instances sign with: long enough for production's check, and never a real secret. */
const TEST_SECRET = 'test-secret-for-the-router-tests-only-0123456789';

/**
 * Builds an auth host over a test database. Migrations must have run.
 *
 * @param db - The test database.
 * @param [baseUrl] - The router's address.
 * @returns The host, built with no OIDC provider unless the database holds a pairing.
 */
export function createTestAuthHost(db: DB, baseUrl: string = TEST_ROUTER_URL): Promise<AuthHost> {
  return createAuthHost(db, { baseUrl: () => baseUrl, secret: TEST_SECRET });
}

/** A signed-in operator, as the UI holds it. */
export interface TestOperator {
  /** The session, for `Authorization: Bearer`. */
  token: string;
  userId: string;
}

/**
 * Signs the local admin in, as SECURE_LOCAL_NET does.
 *
 * @param db - The test database.
 * @param authHost - The host.
 * @returns The session.
 */
export function signInTestOperator(db: DB, authHost: AuthHost): Promise<TestOperator> {
  return signInLocalAdmin(db, authHost.current());
}

/**
 * Mints an API key, as the operator does in Settings.
 *
 * @param db - The test database.
 * @param authHost - The host.
 * @param [name] - What to call it.
 * @returns The key, for `x-api-key` or `Authorization: Bearer`.
 */
export async function mintTestKey(db: DB, authHost: AuthHost, name = 'test agent'): Promise<string> {
  const { userId } = await signInTestOperator(db, authHost);
  const { key } = await createKey(db, authHost.current(), { userId, name, expiresInDays: null });
  return key;
}
