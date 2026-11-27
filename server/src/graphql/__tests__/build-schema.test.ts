import { GraphQLObjectType, GraphQLString, isInputObjectType, isObjectType } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb, type TestDb } from '../../db/__tests__/test-db.ts';
import { createSchema } from '../build-schema.ts';
import { serverMutations, serverQueries } from '../fields/servers.ts';
import { systemMutations, systemQueries } from '../fields/system.ts';
import { workspaceMutations, workspaceQueries } from '../fields/workspaces.ts';

/** Stand-ins for the generated row types, which only the hand-written mutations' return types need here. */
const SERVER = new GraphQLObjectType({ name: 'Server', fields: { id: { type: GraphQLString } } });
const WORKSPACE = new GraphQLObjectType({ name: 'Workspace', fields: { id: { type: GraphQLString } } });

describe('createSchema', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(() => closeTestDb(db));

  it('builds over the tables', () => {
    const { schema } = createSchema(db);
    expect(schema.getQueryType()?.getFields().servers).toBeDefined();
    expect(schema.getMutationType()?.getFields().installServer).toBeDefined();
  });

  it('never serves a secret column', () => {
    const { schema } = createSchema(db);
    const server = schema.getType('Server');
    const setting = schema.getType('Setting');
    const isObject = isObjectType(server) && isObjectType(setting);
    expect(isObject).toBe(true);
    if (isObject) {
      expect(Object.keys(server.getFields())).not.toContain('oauth');
      expect(Object.keys(setting.getFields())).not.toContain('authToken');
    }
  });

  it('offers no nested relation writes', () => {
    const { schema } = createSchema(db);
    const input = schema.getType('CreateWorkspaceInput');
    expect(isInputObjectType(input) && Object.keys(input.getFields())).not.toContain('members');
  });

  it('leaves the server writes CRUD cannot keep safe to hand-written mutations', () => {
    const mutations = createSchema(db).schema.getMutationType()?.getFields() ?? {};
    // updateServer and deleteServer are the hand-written ones, taking a name.
    expect(mutations.updateServer?.args.map((arg) => arg.name)).toEqual(['name', 'input']);
    expect(mutations.deleteServer?.args.map((arg) => arg.name)).toEqual(['name']);
    expect(mutations.updateServers).toBeUndefined();
    expect(mutations.deleteServers).toBeUndefined();
  });

  it('describes every hand-written root field', () => {
    const { schema } = createSchema(db);
    const query = schema.getQueryType()?.getFields() ?? {};
    const mutation = schema.getMutationType()?.getFields() ?? {};
    const handWritten = [
      ...Object.keys({ ...systemQueries(), ...serverQueries(), ...workspaceQueries() }).map((name) => query[name]),
      ...Object.keys({ ...systemMutations(), ...serverMutations(SERVER), ...workspaceMutations(WORKSPACE) }).map(
        (name) => mutation[name],
      ),
    ];
    const undescribed = handWritten.filter((field) => (field?.description ?? '') === '');
    expect(handWritten.length).toBeGreaterThan(0);
    expect(undescribed).toEqual([]);
  });
});
