import { ErrorCode } from '@mcp-router/shared';
import { buildSchema } from '@vantreeseba/drizzle-graphql';
import { type GraphQLSchema, graphql, isInputObjectType } from 'graphql';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, createTestDb, resetTestDb, type TestDb } from '../../db/__tests__/test-db.ts';
import { servers } from '../../db/tables/servers.ts';
import { workspaceMembers } from '../../db/tables/workspace-members.ts';
import { workspaces } from '../../db/tables/workspaces.ts';
import { writeHooks } from '../write-hooks.ts';

// createSchema keeps `features.nestedWrites` off. These tests build the same tables and hooks with it on, to pin down
// why: the hooks do check a nested child's own values, but the nested inputs can't replace a workspace's members.

const CREATE_WITH_MEMBER = `mutation($serverId: UUID!, $url: String) {
  createWorkspace(values: { name: "Work", slug: "work", members: { create: [{ serverId: $serverId, url: $url }] } }) {
    id
    members { url }
  }
}`;

describe('nested writes', () => {
  let db: TestDb;
  let schema: GraphQLSchema;
  let serverId: string;
  const reload = vi.fn(async () => {});

  beforeAll(async () => {
    db = await createTestDb();
    schema = buildSchema(db, {
      prefixes: { insert: 'create', update: 'update', delete: 'delete' },
      typeNameMapper: 'singularize',
      features: { nestedWrites: true },
      onWrite: writeHooks,
    }).schema;
  });

  afterAll(() => closeTestDb(db));

  beforeEach(async () => {
    await resetTestDb(db);
    reload.mockClear();
    const [row] = await db
      .insert(servers)
      .values({
        name: 'remote',
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: 'https://x.test', headers: {} },
      })
      .returning();
    serverId = row?.id ?? '';
  });

  const run = (variables: Record<string, unknown>) =>
    graphql({ schema, source: CREATE_WITH_MEMBER, variableValues: variables, contextValue: { store: { reload } } });

  it("checks a nested child's own values, and rolls the whole write back", async () => {
    const result = await run({ serverId, url: 'not a url' });
    expect(result.errors?.[0]?.extensions.code).toBe(ErrorCode.BadUserInput);
    expect(result.errors?.[0]?.message).toContain('Workspace member');
    expect(await db.select().from(workspaceMembers)).toEqual([]);
    expect(await db.select().from(workspaces)).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('writes a valid nested child, and reloads the gateway after it', async () => {
    const result = await run({ serverId, url: 'https://scoped.x.test/w' });
    expect(result.errors).toBeUndefined();
    expect(result.data?.createWorkspace).toMatchObject({ members: [{ url: 'https://scoped.x.test/w' }] });
    expect(reload).toHaveBeenCalled();
  });

  it("can't replace a workspace's members: the update input offers only create and connect", () => {
    const nested = schema.getType('WorkspaceMembersNestedUpdateInput');
    expect(isInputObjectType(nested) && Object.keys(nested.getFields()).sort()).toEqual(['connect', 'create']);
  });
});
