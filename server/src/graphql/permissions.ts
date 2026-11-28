import { ErrorCode } from '@mcp-router/shared';
import { accept, CacheMode, deny, type PermissionsMap, type Rule, rule } from '@vantreeseba/graphql-casl';
import { CALLER_AGENT, CALLER_OPERATOR, type Context } from '../core/context.ts';
import { codedError } from '../core/errors.ts';

// Who may call what on /graphql and /admin/mcp. The caller comes from the credential (core/context.ts): the operator
// on a session, an agent on an API key, nobody without either.
//
// An agent may do what the router is for: read everything, install and manage servers and workspaces, and call their
// tools, which is what the old router token allowed. Only a person may manage API keys (so a leaked key can't mint
// its successor), change how people sign in, read or end sessions, or edit the settings (`publicUrl` is where sign-in
// lands). Mutations are a whitelist: a generated write a new table adds arrives shut, and so does every bulk form
// (`deleteServers` with no `where` empties the table).

/** What an API key reaching for something only a person may do is told. */
const PEOPLE_ONLY = 'Only a person signed in to the router can do this. An API key cannot.';

/**
 * Refuses nobody.
 *
 * @param ctx - The request.
 * @returns UNAUTHENTICATED for a request with no live credential, otherwise undefined.
 */
function refuseAnonymous(ctx: Context): Error | undefined {
  return ctx.caller === null ? codedError(ErrorCode.Unauthenticated, 'Sign in first, or send an API key.') : undefined;
}

/** A person signed in to the UI. */
const isOperator = rule(
  (_parent, _args, ctx: Context) =>
    refuseAnonymous(ctx) ?? (ctx.caller === CALLER_OPERATOR ? true : codedError(ErrorCode.Forbidden, PEOPLE_ONLY)),
  { name: 'isOperator', cache: CacheMode.Contextual },
);

/** A person or an API key: anyone with a live credential. */
const isCaller = rule((_parent, _args, ctx: Context) => refuseAnonymous(ctx) ?? true, {
  name: 'isCaller',
  cache: CacheMode.Contextual,
});

/** Anyone but an API key: signing in, and pairing a provider on a router with no accounts yet. The resolvers decide. */
const notAKey = rule(
  (_parent, _args, ctx: Context) => (ctx.caller === CALLER_AGENT ? codedError(ErrorCode.Forbidden, PEOPLE_ONLY) : true),
  { name: 'notAKey', cache: CacheMode.Contextual },
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
 * The generated writes a caller may call, for one table: the single-row forms. The plural (bulk) forms stay denied by
 * the Mutation wildcard.
 *
 * @param singular - The table's singular type name in camelCase: `workspace`, `registry`.
 * @param writes - Which single-row writes the table offers.
 * @param allowed - Who may call them.
 * @returns Rules keyed by field name.
 */
function singleRowWrites(
  singular: string,
  writes: ReadonlyArray<'create' | 'update' | 'delete'>,
  allowed: Rule,
): Record<string, Rule> {
  const typeName = `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;
  return Object.fromEntries(writes.map((write) => [`${write}${typeName}`, allowed]));
}

/** Every write a table generates. */
const ALL_WRITES = ['create', 'update', 'delete'] as const;

/** The schema's permission map. Applied once, in createSchema, so it guards /graphql and /admin/mcp alike. */
export const permissions: PermissionsMap = {
  '*': accept,
  Query: {
    '*': isCaller,
    // The sign-in page reads these signed out.
    authConfig: notAKey,
    ssoSetup: notAKey,
    me: isOperator,
    apiKeys: isOperator,
    // They answer with session tokens.
    getSession: isOperator,
    listSessions: isOperator,
  },
  Mutation: {
    '*': deny,
    ...singleRowWrites('registry', ALL_WRITES, isCaller),
    ...singleRowWrites('workspace', ALL_WRITES, isCaller),
    ...singleRowWrites('workspaceMember', ALL_WRITES, isCaller),
    // The one settings row exists from first boot; it is only ever edited, and only by a person.
    ...singleRowWrites('setting', ['update'], isOperator),
    createServer: refuse('A server is added by installing it: call installServer.'),
    installServer: isCaller,
    updateServer: isCaller,
    deleteServer: isCaller,
    restartServer: isCaller,
    clearServerActivity: isCaller,
    startServerOAuth: isCaller,
    checkServerOAuth: isCaller,
    signOutServerOAuth: isCaller,
    saveWorkspace: isCaller,
    clearWorkspaceActivity: isCaller,
    reloadConfig: isCaller,
    callServerTool: isCaller,
    readServerResource: isCaller,
    getServerPrompt: isCaller,
    callWorkspaceTool: isCaller,
    readWorkspaceResource: isCaller,
    getWorkspacePrompt: isCaller,
    setLanServerDismissed: isCaller,
    // Signing in.
    verifyOneTimeToken: notAKey,
    signInOnTrustedNetwork: notAKey,
    // canPairSso decides who: the admin, or anyone while there are no accounts.
    pairSso: notAKey,
    unpairSso: notAKey,
    // A person's own sessions.
    signOut: isOperator,
    revokeSession: isOperator,
    revokeSessions: isOperator,
    revokeOtherSessions: isOperator,
    // From a session only, so a leaked key can't mint its successor or revoke the others.
    createApiKey: isOperator,
    revokeApiKey: isOperator,
  },
};
