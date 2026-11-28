import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode } from '@mcp-router/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';
import type { AuthHost } from '../auth-host.ts';
import { KEY_PREFIX } from '../better-auth.ts';
import { createRateLimiter } from '../rate-limit.ts';
import { LOCAL_ADMIN_EMAIL } from '../trusted-network.ts';
import { createTestAuthHost, mintTestKey, signInTestOperator } from './test-auth.ts';

// Signing in to the UI and the API keys machine callers use, over the real HTTP doors.

const AUTH_CONFIG = '{ authConfig { trustedNetwork sso { name signInUrl } } }';
const TRUSTED_SIGN_IN = 'mutation { signInOnTrustedNetwork { token userId } }';
const ME = '{ me { email role } }';
const CREATE_KEY = 'mutation ($name: String!) { createApiKey(name: $name) { key apiKey { id name start expiresAt } } }';
const KEYS = '{ apiKeys { id name start createdAt lastUsedAt expiresAt } }';
const REVOKE_KEY = 'mutation ($id: UUID!) { revokeApiKey(id: $id) }';
const STATUS = '{ routerStatus { serverCount } }';

describe('signing in and API keys', () => {
  let database: Database;
  let dataDir: string;
  let manager: GatewayManager;
  let authHost: AuthHost;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.SECURE_LOCAL_NET;
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-auth-'));
    await resetTestDb(database);
    const store = await createTestStore(database, dataDir);
    manager = new GatewayManager(() => store.getSettings());
    authHost = await createTestAuthHost(database.db);
    app = createApp({
      db: database.db,
      authHost,
      store,
      manager,
      limiter: createRateLimiter({ maxAttempts: 2 }),
      appDistDir: path.join(dataDir, 'no-such-dist'),
    });
  });

  afterEach(async () => {
    delete process.env.SECURE_LOCAL_NET;
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * Posts one operation to /graphql.
   *
   * @param query - The operation.
   * @param [credential] - Headers to send it with.
   * @param [variables] - Its variables.
   * @returns The answer's body.
   */
  const gql = async (query: string, credential: Record<string, string> = {}, variables?: Record<string, unknown>) =>
    (await request(app).post('/graphql').set(credential).send({ query, variables })).body;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('tells a signed-out sign-in page there is no provider and no trusted network', async () => {
    const { data } = await gql(AUTH_CONFIG);
    expect(data.authConfig).toEqual({ trustedNetwork: false, sso: null });
  });

  it('refuses the trusted-network sign-in without SECURE_LOCAL_NET, and throttles the attempts', async () => {
    const first = await gql(TRUSTED_SIGN_IN);
    expect(first.errors[0].extensions.code).toBe(ErrorCode.Forbidden);
    await gql(TRUSTED_SIGN_IN);
    const third = await gql(TRUSTED_SIGN_IN);
    expect(third.errors[0].extensions.code).toBe(ErrorCode.TooManyRequests);
    expect(third.errors[0].extensions.retryAfter).toBeGreaterThan(0);
  });

  it('signs whoever opens the UI in as the local admin under SECURE_LOCAL_NET, again and again', async () => {
    process.env.SECURE_LOCAL_NET = 'true';
    expect((await gql(AUTH_CONFIG)).data.authConfig.trustedNetwork).toBe(true);
    // More than the throttle's budget: a sign-in that succeeds is given back.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await gql(TRUSTED_SIGN_IN);
      expect(data.signInOnTrustedNetwork.token).toEqual(expect.any(String));
    }
    const { data } = await gql(TRUSTED_SIGN_IN);
    const me = await gql(ME, bearer(data.signInOnTrustedNetwork.token));
    expect(me.data.me).toEqual({ email: LOCAL_ADMIN_EMAIL, role: 'admin' });
  });

  it('refuses everything but signing in to nobody', async () => {
    expect((await gql(STATUS)).errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
    expect((await gql(KEYS)).errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
  });

  it('makes a key from a session, shows it once, and lists it without it', async () => {
    const { token } = await signInTestOperator(database.db, authHost);
    const { data } = await gql(CREATE_KEY, bearer(token), { name: 'claude' });
    const { key, apiKey } = data.createApiKey;
    expect(key.startsWith(KEY_PREFIX)).toBe(true);
    expect(apiKey).toMatchObject({ name: 'claude', expiresAt: null });
    expect(key.startsWith(apiKey.start)).toBe(true);
    const listed = await gql(KEYS, bearer(token));
    expect(listed.data.apiKeys).toEqual([expect.objectContaining({ id: apiKey.id, name: 'claude' })]);
    expect(JSON.stringify(listed)).not.toContain(key);
  });

  it('takes the key on /graphql as an agent and on /mcp, in either header', async () => {
    const key = await mintTestKey(database.db, authHost);
    expect((await gql(STATUS, bearer(key))).data.routerStatus).toEqual({ serverCount: 0 });
    expect((await gql(STATUS, { 'x-api-key': key })).data.routerStatus).toEqual({ serverCount: 0 });
    expect((await request(app).post('/mcp').set(bearer(key)).send({})).status).not.toBe(401);
    expect((await request(app).post('/mcp').set('x-api-key', key).send({})).status).not.toBe(401);
    // The key records its use.
    const { token } = await signInTestOperator(database.db, authHost);
    const [listed] = (await gql(KEYS, bearer(token))).data.apiKeys;
    expect(listed.lastUsedAt).toEqual(expect.any(String));
  });

  it('refuses a key what only a person may do: keys, sessions, settings, the signed-in person', async () => {
    const key = await mintTestKey(database.db, authHost);
    for (const query of [KEYS, ME, '{ listSessions { id } }']) {
      expect((await gql(query, bearer(key))).errors[0].extensions.code).toBe(ErrorCode.Forbidden);
    }
    const minted = await gql(CREATE_KEY, bearer(key), { name: 'successor' });
    expect(minted.errors[0].extensions.code).toBe(ErrorCode.Forbidden);
    const settings = await gql(
      'mutation { updateSetting(set: { lanAdvertise: true }, where: { id: { eq: 1 } }) { lanAdvertise } }',
      bearer(key),
    );
    expect(settings.errors[0].extensions.code).toBe(ErrorCode.Forbidden);
  });

  it('refuses /mcp to a session: MCP clients carry keys', async () => {
    const { token } = await signInTestOperator(database.db, authHost);
    expect((await request(app).post('/mcp').set(bearer(token)).send({})).status).toBe(401);
  });

  it('revokes a key, which stops working on its next request', async () => {
    const key = await mintTestKey(database.db, authHost);
    const { token } = await signInTestOperator(database.db, authHost);
    const [listed] = (await gql(KEYS, bearer(token))).data.apiKeys;
    expect((await gql(REVOKE_KEY, bearer(token), { id: listed.id })).data.revokeApiKey).toBe(true);
    expect((await request(app).post('/mcp').set(bearer(key)).send({})).status).toBe(401);
    expect((await gql(STATUS, bearer(key))).errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
    const again = await gql(REVOKE_KEY, bearer(token), { id: listed.id });
    expect(again.errors[0].extensions.code).toBe(ErrorCode.NotFound);
  });

  it('refuses a request that sends two different keys', async () => {
    const key = await mintTestKey(database.db, authHost);
    const both = await gql(STATUS, { ...bearer(key), 'x-api-key': `${KEY_PREFIX}other` });
    expect(both.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
  });

  it('signs out, which ends the session', async () => {
    const { token } = await signInTestOperator(database.db, authHost);
    expect((await gql('mutation { signOut { success } }', bearer(token))).data.signOut.success).toBe(true);
    expect((await gql(ME, bearer(token))).errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
  });
});
