import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigStore } from '../../config/store.ts';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { settings } from '../../db/tables/settings.ts';
import { users } from '../../db/tables/users.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';
import type { AuthHost } from '../auth-host.ts';
import { ImportedFrom, listKeys } from '../keys.ts';
import { carryOverRouterTokens } from '../router-token.ts';
import { createTestAuthHost } from './test-auth.ts';

// Upgrading from the single router token: MCP clients configured with it keep working, as an API key.

/** A token as the old router generated it: 64 hex characters, no key prefix. */
const OLD_TOKEN = 'a3f1c2d4e5b6978812345678901234567890abcdefabcdefabcdefabcdef0123';

describe('carrying the old router token over', () => {
  let database: Database;
  let dataDir: string;
  let store: ConfigStore;
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
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-token-'));
    await resetTestDb(database);
    store = await createTestStore(database, dataDir);
    // What an upgraded router finds: the token it generated before, still in its settings row.
    await store.updateSettings({ authToken: OLD_TOKEN });
    manager = new GatewayManager(() => store.getSettings());
    authHost = await createTestAuthHost(database.db);
    app = createApp({ db: database.db, authHost, store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const mcpWith = (token: string) => request(app).post('/mcp').set('Authorization', `Bearer ${token}`).send({});

  it('imports the stored token as a key with that exact value, then clears the stored copy', async () => {
    expect((await mcpWith(OLD_TOKEN)).status).toBe(401);
    const carried = await carryOverRouterTokens(database.db, store, {});
    expect(carried).toEqual({ imported: [ImportedFrom.Settings], wasAuthDisabled: false });
    expect((await mcpWith(OLD_TOKEN)).status).not.toBe(401);
    expect((await request(app).post('/mcp').set('x-api-key', OLD_TOKEN).send({})).status).not.toBe(401);
    const [row] = await database.db.select().from(settings);
    expect(row?.authToken).toBeNull();
    expect(await listKeys(database.db)).toEqual([
      expect.objectContaining({
        name: 'Imported router token',
        start: OLD_TOKEN.slice(0, 6),
        importedFrom: 'settings',
      }),
    ]);
  });

  it('works on /graphql too, as an agent', async () => {
    await carryOverRouterTokens(database.db, store, {});
    const res = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${OLD_TOKEN}`)
      .send({ query: '{ routerStatus { serverCount } }' });
    expect(res.body).toEqual({ data: { routerStatus: { serverCount: 0 } } });
  });

  it('makes no account, so a new router can still be paired from its login page', async () => {
    await carryOverRouterTokens(database.db, store, {});
    expect(await database.db.select().from(users)).toEqual([]);
  });

  it('imports MCP_ROUTER_TOKEN as a key too, once, however often the router boots', async () => {
    const env = { MCP_ROUTER_TOKEN: 'env-token-0123456789abcdef0123456789abcdef' };
    expect((await carryOverRouterTokens(database.db, store, env)).imported).toEqual([
      ImportedFrom.Settings,
      ImportedFrom.Env,
    ]);
    expect((await carryOverRouterTokens(database.db, store, env)).imported).toEqual([]);
    expect(await listKeys(database.db)).toHaveLength(2);
    expect((await mcpWith(env.MCP_ROUTER_TOKEN)).status).not.toBe(401);
  });

  it('imports a token set both ways once', async () => {
    const { imported } = await carryOverRouterTokens(database.db, store, { MCP_ROUTER_TOKEN: OLD_TOKEN });
    expect(imported).toEqual([ImportedFrom.Settings]);
    expect(await listKeys(database.db)).toHaveLength(1);
  });

  it('reports a stored authEnabled: false, which no longer turns auth off', async () => {
    await store.updateSettings({ authEnabled: false });
    expect((await carryOverRouterTokens(database.db, store, {})).wasAuthDisabled).toBe(true);
    expect((await request(app).post('/mcp').send({})).status).toBe(401);
  });
});
