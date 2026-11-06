import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServerCard } from '@cubicecho/mcp-discovery';
import { type ServerWatchHandlers, toMcpHost } from '@cubicecho/mcp-discovery/mdns';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../../config/store.ts';
import { createLanServers } from '../../discovery/lan-servers.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';

const FOUND_URL = 'http://192.168.1.20:3000/mcp';

describe('/api/discovery', () => {
  let dataDir: string;
  let store: ConfigStore;
  let manager: GatewayManager;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-lan-'));
    store = new ConfigStore(dataDir);
    await store.init();
    token = store.getSettings().authToken ?? '';
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
    app = createApp({ store, manager, lanServers, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  it('lists what was found, behind the token', async () => {
    expect((await request(app).get('/api/discovery')).status).toBe(401);
    const response = await authed(request(app).get('/api/discovery'));
    expect(response.body).toMatchObject({
      enabled: true,
      servers: [{ suggestedName: 'skills', url: FOUND_URL, state: 'available' }],
    });
  });

  it('dismisses a found server and restores it, keeping the choice in settings.json', async () => {
    const key = 'MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills';
    const dismissed = await authed(request(app).post('/api/discovery/dismissed')).send({ key, dismissed: true });
    expect(dismissed.body.servers[0].state).toBe('dismissed');
    const settings = JSON.parse(await readFile(path.join(dataDir, 'config/settings.json'), 'utf8'));
    expect(settings.lanDismissed).toEqual([key]);
    const restored = await authed(request(app).post('/api/discovery/dismissed')).send({ key, dismissed: false });
    expect(restored.body.servers[0].state).toBe('available');
  });

  it('adds a found server as a remote one that remembers where it came from', async () => {
    const [found] = (await authed(request(app).get('/api/discovery'))).body.servers;
    const added = await authed(request(app).post('/api/servers')).send({
      name: found.suggestedName,
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: found.url, headers: { Authorization: 'Bearer secret' } },
      discovered: { key: found.key, cardName: found.cardName },
    });
    expect(added.status).toBe(201);
    expect(store.getServer('skills')?.discovered).toEqual({ key: found.key, cardName: found.cardName });
    const after = await authed(request(app).get('/api/discovery'));
    expect(after.body.servers[0]).toMatchObject({ state: 'added', serverName: 'skills' });
  });

  it('reports the discovery settings in the status and changes them by PATCH', async () => {
    const status = await authed(request(app).get('/api/status'));
    expect(status.body).toMatchObject({ lanAdvertise: false, lanDiscovery: true });
    expect(status.body.instanceId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const patched = await authed(request(app).patch('/api/settings')).send({ lanAdvertise: true });
    expect(patched.body).toMatchObject({ lanAdvertise: true, lanDiscovery: true });
  });
});
