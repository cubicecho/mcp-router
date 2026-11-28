import { ErrorCode } from '@mcp-router/shared';
import { buildSchema, type SchemaFeatures } from '@vantreeseba/drizzle-graphql';
import { applyPermissions } from '@vantreeseba/graphql-casl';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { applyBetterAuthExtension } from '../auth/endpoints.ts';
import { authMutations, authQueries } from '../auth/resolvers.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { codedError } from '../core/errors.ts';
import type { DB } from '../db/client.ts';
import { ssoMutations, ssoQueries } from '../sso/resolvers.ts';
import { mapDatabaseError } from './database-errors.ts';
import { serverMutations, serverQueries } from './fields/servers.ts';
import { systemMutations, systemQueries } from './fields/system.ts';
import { uiCallMutations } from './fields/ui-calls.ts';
import { workspaceMutations, workspaceQueries } from './fields/workspaces.ts';
import { permissions } from './permissions.ts';
import { writeHooks } from './write-hooks.ts';

/**
 * Columns that are never served. `servers.oauth` holds a remote's tokens (`ServerRuntime.oauth` says where its
 * sign-in stands instead). `settings.authToken` is the old router token, which boot imports as an API key and then
 * clears, and `settings.authEnabled` no longer means anything: both stay in the table until a later release drops them.
 */
const SECRET_COLUMNS = { servers: ['oauth'], settings: ['authToken', 'authEnabled'] };

/**
 * Tables that are never served as generated CRUD: better-auth's own (accounts, sessions, verifications, API keys) and
 * the OIDC pairing, which hold credentials. Sign-in, the signed-in person and the keys are served by hand-written
 * fields instead (auth/resolvers.ts, auth/endpoints.ts, sso/resolvers.ts).
 */
const SERVER_TABLES = ['users', 'sessions', 'accounts', 'verifications', 'apikeys', 'oidcSettings'];

/** Tables whose rows are created by hand-written mutations or by first boot: `installServer`, the settings row. */
const CREATE_RESERVED = new Set<string>(['settings']);
/** Tables whose rows change only through hand-written mutations: `updateServer` keeps a moved server's sign-in safe. */
const UPDATE_RESERVED = new Set<string>(['servers']);
/** Tables whose rows are removed by hand-written mutations: `deleteServer` also stops it and removes its package. */
const DELETE_RESERVED = new Set<string>(['servers', 'settings']);

/**
 * Makes the check for one kind of generated write.
 *
 * @param reserved - The tables whose writes of that kind are hand-written.
 * @returns Whether a table keeps that generated write.
 */
const allowedUnless =
  (reserved: ReadonlySet<string>) =>
  (table: string): boolean =>
    reserved.has(table) === false;

/**
 * Which generated operations exist. `createServer` is kept but refused by permissions, so a client calling it is told
 * to install instead.
 */
const FEATURES: SchemaFeatures = {
  insert: allowedUnless(CREATE_RESERVED),
  update: allowedUnless(UPDATE_RESERVED),
  updateMany: allowedUnless(UPDATE_RESERVED),
  delete: allowedUnless(DELETE_RESERVED),
  upsert: false,
  // Off, though the hooks read each child's own `rows` and would check a nested write correctly: a workspace's
  // members can't be replaced through one (`workspace_members.workspace_id` is NOT NULL, so its update input offers
  // only `create` and `connect`, never `set` or `disconnect`). `saveWorkspace` does that in one transaction.
  nestedWrites: false,
};

/** What `createSchema` hands back. */
export interface BuiltSchema {
  /** The permission-wrapped schema both doors serve. */
  schema: GraphQLSchema;
}

/**
 * Builds the served schema over a database: the generated CRUD, the hand-written fields, then permissions.
 *
 * @param db - The database the resolvers query. Tests pass PGlite.
 * @returns The schema.
 */
export function createSchema(db: DB): BuiltSchema {
  const { entities } = buildSchema(db, {
    prefixes: { insert: 'create', update: 'update', delete: 'delete' },
    // Table keys are plural (`servers`). Types and single-row fields are singular (Server, server).
    typeNameMapper: 'singularize',
    exclude: { tables: SERVER_TABLES, columns: SECRET_COLUMNS },
    features: FEATURES,
    limits: {
      defaultLimit: OPERATION_LIMIT_DEFAULTS.defaultPageSize,
      maxLimit: OPERATION_LIMIT_DEFAULTS.maxPageSize,
    },
    // Publishes each field's cost for operationLimitsPlugin. On by default, and stated so nobody turns it off.
    complexity: true,
    onWrite: writeHooks,
    onError: mapDatabaseError,
  });
  const { Server, Workspace } = entities.types;
  const isMissing = Server === undefined || Workspace === undefined;
  if (isMissing) {
    throw new Error('The generated schema has no Server or Workspace type. Check the tables in db/schema.ts.');
  }

  const query = new GraphQLObjectType({
    name: 'Query',
    fields: {
      ...entities.queries,
      ...systemQueries(),
      ...serverQueries(),
      ...workspaceQueries(),
      ...authQueries(),
      ...ssoQueries(),
    },
  });
  const mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: {
      ...entities.mutations,
      ...systemMutations(),
      ...serverMutations(Server),
      ...workspaceMutations(Workspace),
      ...uiCallMutations(),
      ...authMutations(),
      ...ssoMutations(),
    },
  });
  const base = new GraphQLSchema({
    query,
    mutation,
    types: [...Object.values(entities.types), ...Object.values(entities.inputs)],
  });
  // better-auth's own endpoints: the last leg of an OIDC sign-in, sessions and signing out.
  const withAuth = applyBetterAuthExtension(base, db);
  const schema = applyPermissions(withAuth, permissions, {
    // A refusal names the field, so a client can tell which call to stop making.
    fallbackError: (_original, _parent, _args, _context, info) =>
      codedError(ErrorCode.Forbidden, `Not allowed to call ${info.parentType.name}.${info.fieldName}.`),
  });
  return { schema };
}
