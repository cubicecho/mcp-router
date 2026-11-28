import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServerCard } from '@cubicecho/mcp-discovery';
import { type ServerWatchHandlers, toMcpHost } from '@cubicecho/mcp-discovery/mdns';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestAuthHost, mintTestKey, signInTestOperator } from '../../auth/__tests__/test-auth.ts';
import type { AuthHost } from '../../auth/auth-host.ts';
import type { ConfigStore } from '../../config/store.ts';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { settings } from '../../db/tables/settings.ts';
import { createLanServers } from '../../discovery/lan-servers.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';

const FOUND_URL = 'http://192.168.1.20:3000/mcp';

describe('LAN discovery over /graphql', () => {
  let dataDir: string;
  let store: ConfigStore;
  let database: Database;
  let manager: GatewayManager;
  let token: string;
  let authHost: AuthHost;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-lan-'));
    await resetTestDb(database);
    store = await createTestStore(database, dataDir);
    authHost = await createTestAuthHost(database.db);
    token = await mintTestKey(database.db, authHost);
    manager = new GatewayManager(() => store.getSettings());
    let handlers: ServerWatchHandlers | undefined;
    const lanServers = createLanServers({
      isWanted: () => true,
      ownInstanceName: () => 'MCP Router on box',
      servers: () => store.getServers(),
      dismissed: () => store.getSettings().lanDismissed,
      onMoved: async () => undefined,
      log: () => undefined,
      watch: async (given) => {
        handlers = given;
        return { stop: async () => undefined };
      },
    });
    await lanServers.sync();
    const card = createServerCard({
      name: 'io.github.cubicecho.mcp-skills.nas/skills',
      version: '1.0.0',
      description: 'Skills.',
      remotes: [{ type: 'streamable-http', url: FOUND_URL }],
    });
    const host = toMcpHost({ name: 'MCP Skills on nas', host: 'nas.local', port: 3000, addresses: [], txt: {} });
    handlers?.onUp({
      key: `MCP Skills on nas/${card.name}`,
      host,
      card,
      cardUrl: null,
      connection: { url: FOUND_URL, requiredHeaders: [] },
    });
    app = createApp({
      db: database.db,
      authHost,
      store,
      manager,
      lanServers,
      appDistDir: path.join(dataDir, 'no-such-dist'),
    });
  });

  afterEach(async () => {
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  /**
   * Posts one operation to /graphql with the token.
   *
   * @param query - The operation.
   * @param [variables] - Its variables.
   * @returns The answer's `data`.
   */
  const gql = async (query: string, variables?: Record<string, unknown>) => {
    const { body } = await authed(request(app).post('/graphql')).send({ query, variables });
    expect(body.errors).toBeUndefined();
    return body.data;
  };

  const LAN_SERVERS = '{ lanServers { enabled servers { key cardName suggestedName url state serverName } } }';

  it('lists what was found, behind the token', async () => {
    const anonymous = await request(app).post('/graphql').send({ query: LAN_SERVERS });
    expect(anonymous.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    const { lanServers } = await gql(LAN_SERVERS);
    expect(lanServers).toMatchObject({
      enabled: true,
      servers: [{ suggestedName: 'skills', url: FOUND_URL, state: 'AVAILABLE' }],
    });
  });

  it('dismisses a found server and restores it, keeping the choice in the settings row', async () => {
    const key = 'MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills';
    const dismiss =
      'mutation($key: String!, $dismissed: Boolean!) { setLanServerDismissed(key: $key, dismissed: $dismissed) { servers { state } } }';
    const dismissed = await gql(dismiss, { key, dismissed: true });
    expect(dismissed.setLanServerDismissed.servers[0].state).toBe('DISMISSED');
    const [row] = await database.db.select().from(settings);
    expect(row?.lanDismissed).toEqual([key]);
    const restored = await gql(dismiss, { key, dismissed: false });
    expect(restored.setLanServerDismissed.servers[0].state).toBe('AVAILABLE');
  });

  it('adds a found server as a remote one that remembers where it came from', async () => {
    const [found] = (await gql(LAN_SERVERS)).lanServers.servers;
    await gql('mutation($input: InstallServerInput!) { installServer(input: $input) { id } }', {
      input: {
        name: found.suggestedName,
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: found.url, headers: { Authorization: 'Bearer secret' } },
        discovered: { key: found.key, cardName: found.cardName },
      },
    });
    expect(store.getServer('skills')?.discovered).toEqual({ key: found.key, cardName: found.cardName });
    const after = await gql(LAN_SERVERS);
    expect(after.lanServers.servers[0]).toMatchObject({ state: 'ADDED', serverName: 'skills' });
  });

  it('reports the discovery settings in the status and changes them', async () => {
    const { routerStatus } = await gql('{ routerStatus { lanAdvertise lanDiscovery instanceId } }');
    expect(routerStatus).toMatchObject({ lanAdvertise: false, lanDiscovery: true });
    expect(routerStatus.instanceId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    // The settings are a person's to change, not an API key's.
    const edit =
      'mutation { updateSetting(set: { lanAdvertise: true }, where: { id: { eq: 1 } }) { lanAdvertise lanDiscovery } }';
    const { errors } = (await request(app).post('/graphql').set('x-api-key', token).send({ query: edit })).body;
    expect(errors[0].extensions.code).toBe('FORBIDDEN');
    const { token: session } = await signInTestOperator(database.db, authHost);
    const asOperator = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${session}`)
      .send({ query: edit });
    expect(asOperator.body.data.updateSetting).toEqual({ lanAdvertise: true, lanDiscovery: true });
  });
});
