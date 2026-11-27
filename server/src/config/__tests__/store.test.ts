import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { hostSlug } from '@cubicecho/mcp-discovery';
import { DEFAULT_REGISTRY, type ServerConfig } from '@mcp-router/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { servers } from '../../db/tables/servers.ts';
import { settings } from '../../db/tables/settings.ts';
import { workspaceMembers } from '../../db/tables/workspace-members.ts';
import type { ConfigStore } from '../store.ts';

const TEST_SERVER: ServerConfig = {
  name: 'echo',
  enabled: true,
  source: { type: 'npm', package: 'echo-mcp' },
  transport: { type: 'stdio', command: 'node', args: ['/tmp/echo.js'] },
  env: { API_KEY: 'secret' },
  envMeta: { API_KEY: { isSecret: true } },
};

describe('ConfigStore', () => {
  let database: Database;
  let dataDir: string;
  let store: ConfigStore;
  const envToken = process.env.MCP_ROUTER_TOKEN;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await resetTestDb(database);
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-test-'));
    store = await createTestStore(database, dataDir);
  });

  afterEach(async () => {
    if (envToken !== undefined) {
      process.env.MCP_ROUTER_TOKEN = envToken;
    }
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('seeds settings with a generated auth token and the official registry on first run', async () => {
    const settingsToken = store.getSettings().authToken;
    expect(store.getSettings().authEnabled).toBe(true);
    expect(settingsToken).toMatch(/^[0-9a-f]{64}$/);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(settingsToken as string));

    const [row] = await database.db.select().from(settings);
    expect(row?.authToken).toBe(settingsToken);
    expect(store.getRegistries()).toEqual([DEFAULT_REGISTRY]);
  });

  it('names the router after its hostname on first run, then keeps the name', async () => {
    expect(store.getSettings().instanceId).toBe(hostSlug(hostname(), 'router'));
    await database.db.update(settings).set({ instanceId: 'kept' });
    await store.reload();
    expect(store.getSettings().instanceId).toBe('kept');
  });

  it('does not generate a token when MCP_ROUTER_TOKEN is set', async () => {
    await resetTestDb(database);
    process.env.MCP_ROUTER_TOKEN = 'env-token';
    const withEnvToken = await createTestStore(database, dataDir);
    expect(withEnvToken.getSettings().authToken).toBeNull();
  });

  it('round-trips server configs through the database', async () => {
    await store.saveServer(TEST_SERVER);
    expect(store.getServer('echo')?.env.API_KEY).toBe('secret');

    const fresh = await createTestStore(database, dataDir);
    expect(fresh.getServer('echo')).toEqual(TEST_SERVER);

    await fresh.deleteServer('echo');
    const reloaded = await store.reload();
    expect(reloaded.servers).toHaveLength(0);
  });

  it('emits change after its own writes and after a reload', async () => {
    const changes: string[][] = [];
    store.on('change', (state) => changes.push(state.servers.map((server) => server.name)));
    await store.saveServer(TEST_SERVER);
    await store.reload();
    await store.deleteServer('echo');
    expect(changes).toEqual([['echo'], ['echo'], []]);
  });

  it('picks up a row written straight to the table on reload', async () => {
    await database.db.insert(servers).values({ ...TEST_SERVER, name: 'direct' });
    expect(store.getServer('direct')).toBeUndefined();
    await store.reload();
    expect(store.getServer('direct')?.transport).toEqual(TEST_SERVER.transport);
  });

  it('skips an invalid server row with an error instead of failing the whole load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.saveServer(TEST_SERVER);
    await database.db.insert(servers).values({ ...TEST_SERVER, name: 'NOT VALID!!' });
    await store.reload();
    expect(store.getServers().map((server) => server.name)).toEqual(['echo']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[db] ignoring invalid server "NOT VALID!!"'));
  });

  it('keeps a server change that failed validation out of memory and the database', async () => {
    await expect(store.saveServer({ ...TEST_SERVER, name: 'Bad Name' })).rejects.toThrow();
    expect(store.getServers()).toEqual([]);
    expect(await database.db.select().from(servers)).toEqual([]);
  });

  it('adds and removes registries in order, refusing a duplicate name', async () => {
    const mine = { name: 'mine', url: 'https://registry.example.test' };
    await store.addRegistry(mine);
    expect(store.getRegistries()).toEqual([DEFAULT_REGISTRY, mine]);
    await expect(store.addRegistry(mine)).rejects.toThrow(/already exists/);
    await store.removeRegistry(DEFAULT_REGISTRY.name);
    expect(store.getRegistries()).toEqual([mine]);
    await expect(store.removeRegistry(DEFAULT_REGISTRY.name)).rejects.toThrow(/Unknown registry/);
  });

  it('stores workspace members by server, skipping one that names no server', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveServer(TEST_SERVER);
    const saved = await store.saveWorkspace({
      name: 'Team',
      slug: 'team',
      enabled: true,
      members: { echo: { enabled: true, env: { API_KEY: 'team' } }, ghost: { enabled: true } },
    });
    expect(saved.members).toEqual({ echo: { enabled: true, env: { API_KEY: 'team' } } });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[db\] workspace "team" names server "ghost"/));
    expect(await database.db.select().from(workspaceMembers)).toHaveLength(1);
  });

  it('keeps memberships when a server is replaced, and drops them when it is deleted', async () => {
    await store.saveServer(TEST_SERVER);
    await store.saveWorkspace({ name: 'Team', slug: 'team', enabled: true, members: { echo: { enabled: true } } });
    await store.saveServer({ ...TEST_SERVER, enabled: false });
    expect(Object.keys(store.getWorkspace('team')?.members ?? {})).toEqual(['echo']);
    await store.deleteServer('echo');
    expect(store.getWorkspace('team')?.members).toEqual({});
  });

  it('replaces a workspace by slug, and deletes it with its members', async () => {
    await store.saveServer(TEST_SERVER);
    await store.saveWorkspace({ name: 'Team', slug: 'team', enabled: true, members: { echo: { enabled: true } } });
    await store.saveWorkspace({ name: 'Team two', slug: 'team', enabled: false, members: {} });
    expect(store.getWorkspaces()).toEqual([{ name: 'Team two', slug: 'team', enabled: false, members: {} }]);
    await store.deleteWorkspace('team');
    expect(store.getWorkspaces()).toEqual([]);
  });

  it('throws a friendly error when the settings row is invalid', async () => {
    await database.db.update(settings).set({ port: -1 }).where(eq(settings.port, store.getSettings().port));
    await expect(store.reload()).rejects.toThrow(/settings row failed validation/);
  });
});
