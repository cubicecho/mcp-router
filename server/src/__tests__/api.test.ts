import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { ConfigStore } from '../config/store.ts';
import { GatewayManager } from '../gateway/manager.ts';

describe('REST API', () => {
  let dataDir: string;
  let store: ConfigStore;
  let manager: GatewayManager;
  let token: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-api-'));
    store = new ConfigStore(dataDir);
    await store.init();
    token = store.getSettings().authToken as string;
    manager = new GatewayManager(() => store.getSettings());
    manager.reconcile(store.getServers());
    app = buildApp({ store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  it('requires auth on /api and /mcp', async () => {
    expect((await request(app).get('/api/status')).status).toBe(401);
    expect((await request(app).post('/mcp').send({})).status).toBe(401);
  });

  it('reports router status', async () => {
    const res = await authed(request(app).get('/api/status'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: '0.1.0', serverCount: 0, runningCount: 0, authEnabled: true });
  });

  it('manages registries with validation and conflict handling', async () => {
    const list = await authed(request(app).get('/api/registries'));
    expect(list.body).toEqual([{ name: 'official', url: 'https://registry.modelcontextprotocol.io' }]);

    const bad = await authed(request(app).post('/api/registries')).send({ name: 'x', url: 'not-a-url' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Validation failed');

    const created = await authed(request(app).post('/api/registries')).send({ name: 'mine', url: 'https://r.example' });
    expect(created.status).toBe(201);

    const dup = await authed(request(app).post('/api/registries')).send({ name: 'mine', url: 'https://r.example' });
    expect(dup.status).toBe(409);

    const removed = await authed(request(app).delete('/api/registries/mine'));
    expect(removed.status).toBe(204);
    expect((await authed(request(app).delete('/api/registries/mine'))).status).toBe(404);
  });

  it('installs a remote server, updates it and deletes it', async () => {
    const install = await authed(request(app).post('/api/servers')).send({
      name: 'hosted',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} },
      env: { KEY: 'v1' },
    });
    expect(install.status).toBe(201);
    expect(install.body.state).toBe('stopped');
    expect(install.body.config.name).toBe('hosted');

    const conflict = await authed(request(app).post('/api/servers')).send({
      name: 'hosted',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} },
    });
    expect(conflict.status).toBe(409);

    const patched = await authed(request(app).patch('/api/servers/hosted')).send({
      env: { KEY: 'v2' },
      enabled: false,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.config.env.KEY).toBe('v2');
    expect(patched.body.config.enabled).toBe(false);
    expect(store.getServer('hosted')?.env.KEY).toBe('v2');

    // Disabled servers 404 on their MCP route.
    const mcp = await authed(request(app).post('/mcp/hosted')).send({});
    expect(mcp.status).toBe(404);

    const deleted = await authed(request(app).delete('/api/servers/hosted'));
    expect(deleted.status).toBe(204);
    expect((await authed(request(app).get('/api/servers/hosted'))).status).toBe(404);
  });

  it('serves and clears in-memory activity for a known server', async () => {
    await authed(request(app).post('/api/servers')).send({
      name: 'hosted',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} },
    });

    const empty = await authed(request(app).get('/api/servers/hosted/activity'));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ entries: [] });

    // Records surface newest-first via the manager (the proxy path is covered elsewhere).
    manager.recordActivity('hosted', {
      at: new Date().toISOString(),
      via: 'direct',
      method: 'tools/call',
      target: 'echo',
      ok: true,
      durationMs: 3,
      params: { name: 'echo' },
      result: { ok: true },
    });

    const listed = await authed(request(app).get('/api/servers/hosted/activity'));
    expect(listed.body.entries).toHaveLength(1);
    expect(listed.body.entries[0]).toMatchObject({ method: 'tools/call', target: 'echo', ok: true });
    expect(typeof listed.body.entries[0].id).toBe('number');

    const cleared = await authed(request(app).delete('/api/servers/hosted/activity'));
    expect(cleared.status).toBe(204);
    expect((await authed(request(app).get('/api/servers/hosted/activity'))).body.entries).toEqual([]);

    expect((await authed(request(app).get('/api/servers/nope/activity'))).status).toBe(404);
  });

  it('404s for unknown servers and registries', async () => {
    expect((await authed(request(app).get('/api/servers/nope'))).status).toBe(404);
    expect((await authed(request(app).get('/api/registries/nope/servers'))).status).toBe(404);
    expect((await authed(request(app).post('/mcp/nope')).send({})).status).toBe(404);
  });
});
