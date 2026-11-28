import { ErrorCode } from '@mcp-router/shared';
import { accept, CacheMode, deny, type PermissionsMap, type Rule, rule } from '@vantreeseba/graphql-casl';
import { CALLER_OPERATOR, type Context } from '../core/context.ts';
import { codedError } from '../core/errors.ts';

// Who may call what on /graphql and /admin/mcp. Today there is one caller, the operator, so the map reads as "the
// operator may read everything, and write through this list". Mutations are a whitelist: a generated write a new
// table adds arrives shut, and so does every bulk form (`deleteServers` with no `where` empties the table). A later
// auth step adds API-key callers; their narrower rules go here beside `isOperator`.

/** Anyone who reached the door with the operator's credential. */
const isOperator = rule(
  (_parent, _args, ctx: Context) =>
    ctx.caller === CALLER_OPERATOR ? true : codedError(ErrorCode.Unauthenticated, 'Sign in first.'),
  { name: 'isOperator', cache: CacheMode.Contextual },
);

/**
 * Builds a rule that always refuses, saying what to call instead.
 *
 * @param message - The refusal.
 * @returns The rule. It answers FORBIDDEN.
 */
function refuse(message: string): Rule {
  return rule(() => codedError(ErrorCode.Forbidden, message), { name: 'refuse' });
}

/**
 * The generated writes the operator may call, for one table: the single-row forms. The plural (bulk) forms stay
 * denied by the Mutation wildcard.
 *
 * @param singular - The table's singular type name in camelCase: `workspace`, `registry`.
 * @param writes - Which single-row writes the table offers.
 * @returns Rules keyed by field name.
 */
function singleRowWrites(
  singular: string,
  writes: ReadonlyArray<'create' | 'update' | 'delete'>,
): Record<string, Rule> {
  const typeName = `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;
  return Object.fromEntries(writes.map((write) => [`${write}${typeName}`, isOperator]));
}

/** Every write a table generates that the operator may call. */
const ALL_WRITES = ['create', 'update', 'delete'] as const;

/** The schema's permission map. Applied once, in createSchema, so it guards /graphql and /admin/mcp alike. */
export const permissions: PermissionsMap = {
  '*': accept,
  Query: {
    '*': isOperator,
  },
  Mutation: {
    '*': deny,
    ...singleRowWrites('registry', ALL_WRITES),
    ...singleRowWrites('workspace', ALL_WRITES),
    ...singleRowWrites('workspaceMember', ALL_WRITES),
    // The one settings row exists from first boot; it is only ever edited.
    ...singleRowWrites('setting', ['update']),
    createServer: refuse('A server is added by installing it: call installServer.'),
    installServer: isOperator,
    updateServer: isOperator,
    deleteServer: isOperator,
    restartServer: isOperator,
    clearServerActivity: isOperator,
    startServerOAuth: isOperator,
    checkServerOAuth: isOperator,
    signOutServerOAuth: isOperator,
    saveWorkspace: isOperator,
    clearWorkspaceActivity: isOperator,
    reloadConfig: isOperator,
    callServerTool: isOperator,
    readServerResource: isOperator,
    getServerPrompt: isOperator,
    callWorkspaceTool: isOperator,
    readWorkspaceResource: isOperator,
    getWorkspacePrompt: isOperator,
    setLanServerDismissed: isOperator,
  },
};
