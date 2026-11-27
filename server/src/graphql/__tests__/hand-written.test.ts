import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type DiscoveredServer, DiscoveredServerState, ErrorCode, serverConfigSchema } from '@mcp-router/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database, DB } from '../../db/client.ts';
import { servers } from '../../db/tables/servers.ts';
import { SETTINGS_ROW_ID, settings } from '../../db/tables/settings.ts';
import { workspaceMembers } from '../../db/tables/workspace-members.ts';
import type { LanServers } from '../../discovery/lan-servers.ts';
import { RegistryClient } from '../../registry/client.ts';
import { createHarness, type Harness } from './harness.ts';

/** The stdio MCP server the gateway tests spawn: it offers the tools `pid` and `caller`. */
const ECHO_SERVER = path.join(import.meta.dirname, '../../gateway/__tests__/fixtures/echo-server.ts');
/** A page of the official registry, as the registry tests record it. */
const REGISTRY_PAGE = path.join(import.meta.dirname, '../../registry/__tests__/fixtures/registry-list.json');

const INSTALL_REMOTE = `mutation($name: String!) {
  installServer(input: {
    name: $name
    source: { type: "remote" }
    transport: { type: "streamable-http", url: "https://remote.example.com/mcp" }
  }) { id name enabled transport }
}`;

/** One server found on the network, as discovery reports it. */
const FOUND: DiscoveredServer = {
  key: 'MCP Skills on nas/skills',
  cardName: 'io.github.cubicecho.mcp-skills.nas/skills',
  description: 'Skills',
  version: '1.0.0',
  host: 'MCP Skills on nas',
  url: 'http://nas.local:3000/mcp',
  requiredHeaders: [],
  suggestedName: 'skills',
  state: DiscoveredServerState.Available,
};

describe('hand-written server fields', () => {
  let database: Database;
  let db: DB;
  let harness: Harness;

  beforeAll(async () => {
    database = await createTestDb();
    db = database.db;
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDb(database);
    harness = await createHarness(database);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  it('installs a remote server: records its row and has the gateway reload', async () => {
    const reload = vi.spyOn(harness.store, 'reload');
    const { installServer } = await harness.expectOk(INSTALL_REMOTE, { name: 'remote' });
    expect(installServer).toMatchObject({ name: 'remote', enabled: true });
    expect(installServer.transport).toMatchObject({ url: 'https://remote.example.com/mcp' });
    expect(await db.select({ name: servers.name }).from(servers)).toEqual([{ name: 'remote' }]);
    expect(reload).toHaveBeenCalled();
  });

  it('refuses a second install under a taken name as CONFLICT', async () => {
    await harness.expectOk(INSTALL_REMOTE, { name: 'remote' });
    const { code } = await harness.expectError(INSTALL_REMOTE, { name: 'remote' });
    expect(code).toBe(ErrorCode.Conflict);
  });

  it('refuses an install the shared rules reject', async () => {
    const { code } = await harness.expectError(`mutation { installServer(input: { source: { type: "ftp" } }) { id } }`);
    expect(code).toBe(ErrorCode.BadUserInput);
  });

  it('edits a server and leaves what the edit did not name', async () => {
    await harness.expectOk(INSTALL_REMOTE, { name: 'remote' });
    const edit = `mutation { updateServer(name: "remote", input: { displayName: "Remote" }) { displayName transport } }`;
    const { updateServer } = await harness.expectOk(edit);
    expect(updateServer.displayName).toBe('Remote');
    expect(updateServer.transport).toMatchObject({ url: 'https://remote.example.com/mcp' });
  });

  it('refuses an edit of a server that does not exist as NOT_FOUND', async () => {
    const edit = `mutation { updateServer(name: "ghost", input: { enabled: false }) { id } }`;
    expect((await harness.expectError(edit)).code).toBe(ErrorCode.NotFound);
  });

  it('deletes a server, and its workspace memberships with it', async () => {
    const { installServer } = await harness.expectOk(INSTALL_REMOTE, { name: 'remote' });
    const save = `mutation($serverId: UUID!) {
      saveWorkspace(input: { name: "Work", members: [{ serverId: $serverId }] }) { id }
    }`;
    await harness.expectOk(save, { serverId: installServer.id });
    const { deleteServer } = await harness.expectOk(`mutation { deleteServer(name: "remote") { name } }`);
    expect(deleteServer).toEqual({ name: 'remote' });
    expect(await db.select().from(servers)).toEqual([]);
    expect(await db.select().from(workspaceMembers)).toEqual([]);
  });

  it("refuses the runtime of a server the gateway doesn't run as NOT_FOUND", async () => {
    const { code } = await harness.expectError(`{ serverRuntime(name: "ghost") { state } }`);
    expect(code).toBe(ErrorCode.NotFound);
  });
});

describe('hand-written gateway fields', () => {
  let database: Database;
  let harness: Harness;

  beforeAll(async () => {
    database = await createTestDb();
    harness = await createHarness(database);
    // The gateway runs what the store holds, so the echo server is saved the way the gateway reads it.
    await harness.store.saveServer(
      serverConfigSchema.parse({
        name: 'echo',
        source: { type: 'npm', package: 'none' },
        transport: { type: 'stdio', command: process.execPath, args: [ECHO_SERVER] },
      }),
    );
    await harness.store.saveWorkspace({
      name: 'Work',
      slug: 'work',
      enabled: true,
      members: { echo: { enabled: true } },
    });
    await harness.manager.reconcile(harness.store.getServers(), harness.store.getWorkspaces());
  });

  afterAll(async () => {
    await harness.close();
    await database.close();
  });

  it("lists a server's tools, a page at a time", async () => {
    const { serverTools } = await harness.expectOk(`{ serverTools(name: "echo") { name } }`);
    expect(serverTools.map((tool: { name: string }) => tool.name).sort()).toEqual(['caller', 'pid']);
    const { serverTools: firstPage } = await harness.expectOk(`{ serverTools(name: "echo", limit: 1) { name } }`);
    expect(firstPage).toHaveLength(1);
  });

  it("reports a server's live state, and restarts it", async () => {
    await harness.expectOk(`{ serverTools(name: "echo") { name } }`);
    const { serverRuntime } = await harness.expectOk(`{ serverRuntime(name: "echo") { name state toolCount } }`);
    expect(serverRuntime).toEqual({ name: 'echo', state: 'RUNNING', toolCount: 2 });
    const { restartServer } = await harness.expectOk(`mutation { restartServer(name: "echo") { state } }`);
    expect(restartServer.state).toBe('RUNNING');
  });

  it('lists none for a capability a server lacks', async () => {
    const { serverPrompts } = await harness.expectOk(`{ serverPrompts(name: "echo") { name } }`);
    expect(serverPrompts).toEqual([]);
  });

  it("lists a workspace's tools namespaced as its aggregate serves them", async () => {
    const { workspaceTools } = await harness.expectOk(`{ workspaceTools(slug: "work") { name } }`);
    expect(workspaceTools.map((tool: { name: string }) => tool.name).sort()).toEqual(['echo__caller', 'echo__pid']);
  });

  it("refuses an unknown workspace's tools as NOT_FOUND", async () => {
    const { code } = await harness.expectError(`{ workspaceTools(slug: "ghost") { name } }`);
    expect(code).toBe(ErrorCode.NotFound);
  });

  it('clears a server activity log', async () => {
    const cleared = await harness.expectOk(`mutation { clearServerActivity(name: "echo") }`);
    expect(cleared).toEqual({ clearServerActivity: true });
    const { serverActivity } = await harness.expectOk(`{ serverActivity(name: "echo") { id } }`);
    expect(serverActivity).toEqual([]);
  });
});

describe('hand-written router fields', () => {
  let database: Database;
  let db: DB;
  let harness: Harness;
  const registryFetch = vi.fn<typeof fetch>();
  const found: LanServers = { sync: async () => undefined, list: () => [FOUND], close: async () => undefined };

  beforeAll(async () => {
    database = await createTestDb();
    db = database.db;
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDb(database);
    registryFetch.mockReset();
    harness = await createHarness(database, { registryClient: new RegistryClient(registryFetch), lanServers: found });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  it("answers the router's status", async () => {
    const { routerStatus } = await harness.expectOk('{ routerStatus { serverCount runningCount authEnabled } }');
    expect(routerStatus).toEqual({ serverCount: 0, runningCount: 0, authEnabled: true });
  });

  it("browses a registry's servers, passing the page size on", async () => {
    registryFetch.mockResolvedValue(new Response(await readFile(REGISTRY_PAGE, 'utf-8')));
    const { registryServers } = await harness.expectOk(
      `{ registryServers(registry: "official", search: "everything", limit: 5) { servers nextCursor } }`,
    );
    expect(registryServers.servers.length).toBeGreaterThan(0);
    const [url] = registryFetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('limit=5');
    expect(String(url)).toContain('search=everything');
  });

  it('refuses an unknown registry as NOT_FOUND', async () => {
    const { code } = await harness.expectError(`{ registryServers(registry: "ghost") { nextCursor } }`);
    expect(code).toBe(ErrorCode.NotFound);
  });

  it('lists the servers found on the network, and records a dismissal', async () => {
    const { lanServers } = await harness.expectOk('{ lanServers { servers { key state } } }');
    expect(lanServers.servers).toEqual([{ key: FOUND.key, state: 'AVAILABLE' }]);
    const reload = vi.spyOn(harness.store, 'reload');
    await harness.expectOk(
      `mutation($key: String!) { setLanServerDismissed(key: $key, dismissed: true) { enabled } }`,
      {
        key: FOUND.key,
      },
    );
    const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID));
    expect(row?.lanDismissed).toEqual([FOUND.key]);
    expect(reload).toHaveBeenCalled();
  });

  it('saves a workspace with its members, then replaces the members in one call', async () => {
    const install = (name: string) => harness.expectOk(INSTALL_REMOTE, { name });
    const first = (await install('first')).installServer.id;
    const second = (await install('second')).installServer.id;
    const save = `mutation($input: SaveWorkspaceInput!) {
      saveWorkspace(input: $input) { id slug members { serverId env } }
    }`;
    const created = await harness.expectOk(save, {
      input: { name: 'My Work', members: [{ serverId: first, env: { A: '1' } }] },
    });
    expect(created.saveWorkspace).toMatchObject({ slug: 'my-work', members: [{ serverId: first, env: { A: '1' } }] });

    const replaced = await harness.expectOk(save, {
      input: { id: created.saveWorkspace.id, name: 'My Work', members: [{ serverId: second }] },
    });
    expect(replaced.saveWorkspace.members).toEqual([{ serverId: second, env: null }]);
  });

  it('refuses a saved member whose server does not exist, and writes nothing', async () => {
    const save = `mutation { saveWorkspace(input: { name: "Work", members: [{ serverId: "00000000-0000-4000-8000-000000000000" }] }) { id } }`;
    const { code } = await harness.expectError(save);
    expect(code).toBe(ErrorCode.BadUserInput);
    const { workspaces } = await harness.expectOk('{ workspaces { id } }');
    expect(workspaces).toEqual([]);
  });

  it('reloads the config on request', async () => {
    const { reloadConfig } = await harness.expectOk('mutation { reloadConfig { reloaded serverCount } }');
    expect(reloadConfig).toEqual({ reloaded: true, serverCount: 0 });
  });
});
