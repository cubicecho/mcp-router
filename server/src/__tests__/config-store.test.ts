import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ServerConfig } from '@mcp-router/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../config/store.ts';

const TEST_SERVER: ServerConfig = {
  name: 'echo',
  enabled: true,
  source: { type: 'npm', package: 'echo-mcp' },
  transport: { type: 'stdio', command: 'node', args: ['/tmp/echo.js'] },
  env: { API_KEY: 'secret' },
  envMeta: { API_KEY: { isSecret: true } },
};

describe('ConfigStore', () => {
  let dataDir: string;
  let store: ConfigStore;
  const envToken = process.env.MCP_ROUTER_TOKEN;

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-test-'));
    store = new ConfigStore(dataDir);
  });

  afterEach(async () => {
    if (envToken !== undefined) {
      process.env.MCP_ROUTER_TOKEN = envToken;
    }
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('seeds settings with a generated auth token and the official registry on first run', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await store.init();

    const settings = store.getSettings();
    expect(settings.authEnabled).toBe(true);
    expect(settings.authToken).toMatch(/^[0-9a-f]{64}$/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(settings.authToken as string));

    const settingsFile = path.join(dataDir, 'config', 'settings.json');
    const onDisk = JSON.parse(await readFile(settingsFile, 'utf8'));
    expect(onDisk.authToken).toBe(settings.authToken);
    const mode = (await stat(settingsFile)).mode & 0o777;
    expect(mode).toBe(0o600);

    expect(store.getRegistries()).toEqual([{ name: 'official', url: 'https://registry.modelcontextprotocol.io' }]);
  });

  it('does not generate a token when MCP_ROUTER_TOKEN is set', async () => {
    process.env.MCP_ROUTER_TOKEN = 'env-token';
    await store.init();
    expect(store.getSettings().authToken).toBeNull();
  });

  it('round-trips server configs through disk and reload', async () => {
    await store.init();
    await store.saveServer(TEST_SERVER);
    expect(store.getServer('echo')?.env.API_KEY).toBe('secret');

    const fresh = new ConfigStore(dataDir);
    await fresh.init();
    expect(fresh.getServer('echo')).toEqual(TEST_SERVER);

    await fresh.deleteServer('echo');
    const reloaded = await store.reload();
    expect(reloaded.servers).toHaveLength(0);
    await fresh.close();
  });

  it('preserves unknown keys in hand-edited server files', async () => {
    await store.init();
    await writeFile(
      path.join(dataDir, 'config', 'servers', 'echo.json'),
      JSON.stringify({ ...TEST_SERVER, myNote: 'keep me' }),
    );
    await store.reload();
    const config = store.getServer('echo') as ServerConfig & { myNote?: string };
    expect(config.myNote).toBe('keep me');
    await store.saveServer(config);
    const onDisk = JSON.parse(await readFile(path.join(dataDir, 'config', 'servers', 'echo.json'), 'utf8'));
    expect(onDisk.myNote).toBe('keep me');
  });

  it('skips invalid server files with an error instead of failing the whole load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.init();
    await store.saveServer(TEST_SERVER);
    await writeFile(path.join(dataDir, 'config', 'servers', 'broken.json'), '{ "name": "NOT VALID!!" }');
    await writeFile(path.join(dataDir, 'config', 'servers', 'not-json.json'), 'nope');
    await store.reload();
    expect(store.getServers().map((s) => s.name)).toEqual(['echo']);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('throws a friendly error when settings.json is invalid', async () => {
    await store.init();
    await writeFile(path.join(dataDir, 'config', 'settings.json'), '{ "port": "not-a-number" }');
    await expect(store.reload()).rejects.toThrow(/settings\.json failed validation/);
  });
});
