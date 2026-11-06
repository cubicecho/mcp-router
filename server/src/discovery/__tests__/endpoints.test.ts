import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cardConnection, parseAiCatalog, parseServerCard } from '@cubicecho/mcp-discovery';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../../config/store.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';
import { ROUTER_ROLE_META_KEY } from '../endpoints.ts';

describe('discovery documents', () => {
  let dataDir: string;
  let store: ConfigStore;
  let manager: GatewayManager;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-discovery-'));
    store = new ConfigStore(dataDir);
    await store.init();
    await store.updateSettings({ instanceId: 'nas' });
    await store.saveServer({
      name: 'context7',
      enabled: true,
      source: { type: 'registry', registry: 'official', serverName: 'io.github.upstash/context7' },
      transport: { type: 'streamable-http', url: 'https://mcp.context7.com/mcp', headers: {} },
      env: {},
      envMeta: {},
    });
    await store.saveServer({
      name: 'off',
      enabled: false,
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://example.com/mcp', headers: {} },
      env: {},
      envMeta: {},
    });
    await store.saveWorkspace({ name: 'Team', slug: 'team', enabled: true, members: {} });
    manager = new GatewayManager(() => store.getSettings());
    app = createApp({ store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('lists the aggregate, every enabled server and every enabled workspace, without a token', async () => {
    const response = await request(app).get('/.well-known/ai-catalog.json');
    expect(response.status).toBe(200);
    const catalog = parseAiCatalog(response.body, 'test');
    expect(catalog.entries.map((entry) => new URL(entry.url ?? '').pathname)).toEqual([
      '/mcp/server-card',
      '/mcp/context7/server-card',
      '/mcp/w/team/server-card',
    ]);
    expect(catalog.entries[0]?.identifier).toBe('urn:air:nas.mcp-router:mcp:aggregate');
  });

  it('marks every card as a router’s, and names a proxied server’s upstream', async () => {
    const card = parseServerCard((await request(app).get('/mcp/context7/server-card')).body, 'test');
    expect(card.name).toBe('io.github.cubicecho.mcp-router.nas/context7');
    expect(card._meta).toEqual({
      [ROUTER_ROLE_META_KEY]: 'server',
      'io.github.cubicecho.mcp-router/upstream': 'io.github.upstash/context7',
    });
    const aggregate = parseServerCard((await request(app).get('/mcp/server-card')).body, 'test');
    expect(aggregate._meta?.[ROUTER_ROLE_META_KEY]).toBe('aggregate');
  });

  it('asks for the router token when auth is on, and points at the address the client used', async () => {
    const response = await request(app).get('/mcp/w/team/server-card').set('Host', 'nas.local:3000');
    expect(cardConnection(parseServerCard(response.body, 'test'))).toEqual({
      url: 'http://nas.local:3000/mcp/w/team',
      requiredHeaders: ['Authorization'],
    });
    await store.updateSettings({ authEnabled: false });
    const open = await request(app).get('/mcp/w/team/server-card');
    expect(cardConnection(parseServerCard(open.body, 'test'))?.requiredHeaders).toEqual([]);
  });

  it('keeps /mcp itself behind the token', async () => {
    expect((await request(app).post('/mcp').send({})).status).toBe(401);
  });
});
