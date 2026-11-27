import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { servers } from '../../db/tables/servers.ts';
import { settings } from '../../db/tables/settings.ts';
import { IMPORTED_SUFFIX } from '../import.ts';

/** A data dir as an older, file-backed router left it. */
const FIXTURE_DATA_DIR = fileURLToPath(new URL('./fixtures/data-dir', import.meta.url));

describe('first-boot import of the config files', () => {
  let database: Database;
  let dataDir: string;
  let configDir: string;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await resetTestDb(database);
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-import-'));
    configDir = path.join(dataDir, 'config');
    await cp(FIXTURE_DATA_DIR, dataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('imports settings, registries, servers and workspaces', async () => {
    const store = await createTestStore(database, dataDir);
    const settingsFile = store.getSettings();
    expect(settingsFile).toMatchObject({
      authToken: 'fixture-token-0123456789abcdef0123456789abcdef',
      allowedOrigins: ['https://claude.ai'],
      instanceId: 'nas',
      lanAdvertise: true,
      lanDismissed: ['MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills'],
    });
    expect(store.getRegistries().map((registry) => registry.name)).toEqual(['official', 'mine']);
    expect(store.getServers().map((server) => server.name)).toEqual(['context7', 'echo']);
    expect(store.getServer('echo')).toMatchObject({
      enabled: false,
      env: { API_KEY: 'echo-secret' },
      idleTimeoutMs: 300000,
    });
    expect(store.getServer('context7')?.transport).toEqual({
      type: 'streamable-http',
      url: 'https://mcp.context7.com/mcp',
      headers: { CONTEXT7_API_KEY: 'ctx7-secret' },
    });
    expect(store.getWorkspace('team')).toEqual({
      name: 'Team',
      slug: 'team',
      enabled: true,
      description: "What the team's agents get.",
      members: {
        context7: { enabled: true, headers: { CONTEXT7_API_KEY: 'team-key' } },
        echo: { enabled: false, env: { API_KEY: 'team-echo' }, args: ['--team'] },
      },
    });
  });

  it('logs one [db] summary, the dropped keys, the skipped member and the invalid file', async () => {
    await createTestStore(database, dataDir);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[db\] imported settings, 2 registries, 2 servers, 1 workspaces from /),
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path.join(configDir, 'settings.json')));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('names server "ghost"'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(path.join(configDir, 'servers', 'broken.json')));
  });

  it('renames each imported file, leaving an invalid one as it was', async () => {
    await createTestStore(database, dataDir);
    expect((await readdir(configDir)).sort()).toEqual([
      `registries.json${IMPORTED_SUFFIX}`,
      'servers',
      `settings.json${IMPORTED_SUFFIX}`,
      'workspaces',
    ]);
    expect((await readdir(path.join(configDir, 'servers'))).sort()).toEqual([
      'broken.json',
      `context7.json${IMPORTED_SUFFIX}`,
      `echo.json${IMPORTED_SUFFIX}`,
    ]);
    expect(await readdir(path.join(configDir, 'workspaces'))).toEqual([`team.json${IMPORTED_SUFFIX}`]);
  });

  it('does not import again on a second boot', async () => {
    await createTestStore(database, dataDir);
    await database.db.delete(servers).where(eq(servers.name, 'echo'));
    await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ port: 4000 }));

    const second = await createTestStore(database, dataDir);
    expect(second.getSettings().port).toBe(3000);
    expect(second.getServer('echo')).toBeUndefined();
    expect(await readdir(configDir)).toContain('settings.json');
  });

  it('stores nothing when settings.json is invalid', async () => {
    await writeFile(path.join(configDir, 'settings.json'), '{ "port": "not-a-number" }');
    await expect(createTestStore(database, dataDir)).rejects.toThrow(/settings\.json failed validation/);
    expect(await database.db.select().from(settings)).toEqual([]);
    expect(await database.db.select().from(servers)).toEqual([]);
    expect(await readdir(configDir)).toContain('registries.json');
  });
});
