import { once } from 'node:events';
import { ErrorCode, serverConfigSchema } from '@mcp-router/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database, DB } from '../../db/client.ts';
import { registries } from '../../db/tables/registries.ts';
import { workspaceInstanceKey } from '../../gateway/instance-key.ts';
import { createHarness, type Harness } from './harness.ts';

const CREATE_WORKSPACE = `mutation($slug: String!) { createWorkspace(values: { name: "Work", slug: $slug }) { id slug } }`;
const RENAME_WORKSPACE = `mutation($id: UUID!, $name: String!) {
  updateWorkspace(where: { id: { eq: $id } }, set: { name: $name }) { id name slug }
}`;

const CREATE_MEMBER = `mutation($workspaceId: UUID!, $serverId: UUID!) {
  createWorkspaceMember(values: { workspaceId: $workspaceId, serverId: $serverId }) { id }
}`;

describe('generated CRUD', () => {
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

  it('reads rows through a generated query', async () => {
    await db.insert(registries).values({ name: 'extra', url: 'https://registry.example.com' });
    const data = await harness.expectOk('{ registries { name url } }');
    expect(data.registries).toContainEqual({ name: 'extra', url: 'https://registry.example.com' });
  });

  it('round-trips a generated single-row update', async () => {
    const { createWorkspace } = await harness.expectOk(CREATE_WORKSPACE, { slug: 'work' });
    const { updateWorkspace } = await harness.expectOk(RENAME_WORKSPACE, { id: createWorkspace.id, name: 'Renamed' });
    expect(updateWorkspace).toEqual({ id: createWorkspace.id, name: 'Renamed', slug: 'work' });
    const { workspaces } = await harness.expectOk('{ workspaces { name } }');
    expect(workspaces).toEqual([{ name: 'Renamed' }]);
  });

  it('reloads the store once a write commits', async () => {
    const reload = vi.spyOn(harness.store, 'reload');
    await harness.expectOk(CREATE_WORKSPACE, { slug: 'work' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows a write through the store, and its change reaches the gateway', async () => {
    await harness.store.saveServer(
      serverConfigSchema.parse({
        name: 'remote',
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: 'https://remote.example.com/mcp' },
      }),
    );
    const { servers } = await harness.expectOk('{ servers { id name } }');
    const { createWorkspace } = await harness.expectOk(CREATE_WORKSPACE, { slug: 'work' });
    const changed = once(harness.store, 'change');
    await harness.expectOk(CREATE_MEMBER, { workspaceId: createWorkspace.id, serverId: servers[0].id });
    const [state] = await changed;

    expect(state.workspaces).toEqual(harness.store.getWorkspaces());
    expect(harness.store.getWorkspace('work')?.members).toEqual({ remote: { enabled: true } });
    expect(harness.store.getServers().map((server) => server.name)).toEqual(['remote']);
    // The harness follows the store as boot does, so the change alone gave the workspace its own instance.
    expect(harness.manager.status(workspaceInstanceKey('work', 'remote'))).toBeDefined();
  });

  it('refuses a slug the workspace rules reject, writes nothing and does not reload', async () => {
    const reload = vi.spyOn(harness.store, 'reload');
    const { code } = await harness.expectError(CREATE_WORKSPACE, { slug: 'Not A Slug' });
    expect(code).toBe(ErrorCode.BadUserInput);
    const { workspaces } = await harness.expectOk('{ workspaces { id } }');
    expect(workspaces).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('refuses a taken slug as CONFLICT', async () => {
    await harness.expectOk(CREATE_WORKSPACE, { slug: 'work' });
    const { code } = await harness.expectError(CREATE_WORKSPACE, { slug: 'work' });
    expect(code).toBe(ErrorCode.Conflict);
  });

  it('refuses a registry whose URL is not one', async () => {
    const { code } = await harness.expectError(
      `mutation { createRegistry(values: { name: "bad", url: "nope" }) { id } }`,
    );
    expect(code).toBe(ErrorCode.BadUserInput);
  });

  it('edits the settings the UI edits, and refuses the ones it does not', async () => {
    // The store's first boot seeded the settings row, so the update has a row to change.
    const edit = `mutation { updateSetting(where: { id: { eq: 1 } }, set: { lanAdvertise: true }) { lanAdvertise } }`;
    expect((await harness.expectOk(edit)).updateSetting).toEqual({ lanAdvertise: true });
    const locked = `mutation { updateSetting(where: { id: { eq: 1 } }, set: { port: 1 }) { port } }`;
    const { code } = await harness.expectError(locked);
    expect(code).toBe(ErrorCode.BadUserInput);
  });
});

describe('permissions', () => {
  let database: Database;
  let harness: Harness;

  beforeAll(async () => {
    database = await createTestDb();
    harness = await createHarness(database);
  });

  afterAll(async () => {
    await harness.close();
    await database.close();
  });

  it('refuses a bulk delete as FORBIDDEN', async () => {
    const { code } = await harness.expectError(`mutation { deleteWorkspaces(where: { slug: { eq: "x" } }) { id } }`);
    expect(code).toBe(ErrorCode.Forbidden);
  });

  it('refuses a bulk update as FORBIDDEN', async () => {
    const bulk = `mutation { updateRegistries(where: { name: { eq: "x" } }, set: { url: "https://x.test" }) { id } }`;
    const { code } = await harness.expectError(bulk);
    expect(code).toBe(ErrorCode.Forbidden);
  });

  it('refuses the generated createServer as FORBIDDEN, naming installServer', async () => {
    const create = `mutation {
      createServer(values: { name: "x", source: { type: "remote" }, transport: { type: "streamable-http", url: "https://x.test" } }) { id }
    }`;
    const { code, message } = await harness.expectError(create);
    expect(code).toBe(ErrorCode.Forbidden);
    expect(message).toContain('installServer');
  });

  it('refuses a caller who is not the operator', async () => {
    const result = await harness.run('{ servers { id } }', {}, null);
    expect(result.errors?.[0]?.extensions.code).toBe(ErrorCode.Unauthenticated);
  });
});
