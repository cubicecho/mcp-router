import { CallVia, DiscoveredServerState, ServerRuntimeState } from '@mcp-router/shared';
import { GraphQLJSON, GraphQLUUID } from '@vantreeseba/drizzle-graphql';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  type GraphQLEnumValueConfigMap,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLString,
  type GraphQLType,
} from 'graphql';

// The types the hand-written fields answer with and take: what the gateway, the installer, the registries and the
// network report, which no table holds. They mirror the shared DTOs in `@mcp-router/shared` (api.ts).

/**
 * Wraps a type as non-null.
 *
 * @typeParam T - The type.
 * @param type - The type.
 * @returns `type!`.
 */
const required = <T extends GraphQLType>(type: T) => new GraphQLNonNull(type);

/**
 * Wraps a type as a non-null list of non-null items.
 *
 * @param type - The item type.
 * @returns `[type!]!`.
 */
export const listOf = (type: GraphQLOutputType) => required(new GraphQLList(required(type)));

/**
 * Builds a GraphQL enum over a shared vocabulary. A value such as `needs-auth` is no GraphQL name, so each is served
 * under its member's name in SCREAMING_CASE (`NEEDS_AUTH`) and resolves to the stored word.
 *
 * @param name - The enum's name.
 * @param description - What it says.
 * @param vocabulary - The shared `as const` object.
 * @returns The enum.
 */
function enumOf(name: string, description: string, vocabulary: Readonly<Record<string, string>>): GraphQLEnumType {
  const values: GraphQLEnumValueConfigMap = Object.fromEntries(
    Object.entries(vocabulary).map(([member, value]) => [
      member.replace(/(?<=[a-z])(?=[A-Z])/g, '_').toUpperCase(),
      { value },
    ]),
  );
  return new GraphQLEnumType({ name, description, values });
}

export const ServerRuntimeStateType = enumOf(
  'ServerRuntimeState',
  "What a server's downstream connection is doing.",
  ServerRuntimeState,
);
export const CallViaType = enumOf('CallVia', 'Which door a recorded call came in by.', CallVia);
export const LanServerStateType = enumOf(
  'LanServerState',
  'What has become of a server found on the local network.',
  DiscoveredServerState,
);

export const RouterStatusType = new GraphQLObjectType({
  name: 'RouterStatus',
  description: "The router's own status: version, uptime, server counts and whether auth is on.",
  fields: {
    version: { type: required(GraphQLString) },
    uptimeSeconds: { type: required(GraphQLInt) },
    serverCount: { type: required(GraphQLInt) },
    runningCount: { type: required(GraphQLInt) },
    authEnabled: { type: required(GraphQLBoolean) },
    idleTimeoutMs: { type: required(GraphQLFloat), description: 'Default idle shutdown for stdio children, in ms.' },
    publicUrl: { type: GraphQLString },
    instanceId: { type: required(GraphQLString), description: "This router's name on the network." },
    lanAdvertise: { type: required(GraphQLBoolean) },
    lanDiscovery: { type: required(GraphQLBoolean) },
  },
});

export const ServerOAuthStatusType = new GraphQLObjectType({
  name: 'ServerOAuthStatus',
  description: "Where a remote server's OAuth sign-in stands. Never carries a token.",
  fields: {
    signedIn: { type: required(GraphQLBoolean) },
    expiresAt: { type: GraphQLString, description: 'When the access token runs out, ISO.' },
    refreshable: { type: required(GraphQLBoolean) },
    clientId: { type: GraphQLString, description: 'The pre-registered client id, when one was typed in.' },
    hasClientSecret: { type: required(GraphQLBoolean) },
  },
});

export const ServerRuntimeType = new GraphQLObjectType({
  name: 'ServerRuntime',
  description: "A server's live state in the gateway: its connection, its last error and its call counts.",
  fields: {
    name: { type: required(GraphQLString), description: "The server's name, as `Server.name`." },
    state: { type: required(ServerRuntimeStateType) },
    pid: { type: GraphQLInt },
    startedAt: { type: GraphQLString, description: 'ISO.' },
    lastError: { type: GraphQLString },
    toolCount: { type: GraphQLInt, description: 'Known once the server has been connected at least once.' },
    callCount: { type: GraphQLInt, description: 'Proxied calls recorded since the router started.' },
    lastCalledAt: { type: GraphQLString, description: 'ISO.' },
    oauth: { type: ServerOAuthStatusType, description: "A remote server's sign-in; null for a stdio server." },
  },
});

export const McpToolType = new GraphQLObjectType({
  name: 'McpTool',
  description: 'One tool a server offers, as MCP tools/list reports it.',
  fields: {
    name: { type: required(GraphQLString) },
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    inputSchema: { type: GraphQLJSON, description: 'The JSON Schema of its arguments.' },
    outputSchema: { type: GraphQLJSON },
    annotations: { type: GraphQLJSON },
  },
});

export const McpResourceType = new GraphQLObjectType({
  name: 'McpResource',
  description: 'One resource a server offers, as MCP resources/list reports it.',
  fields: {
    uri: { type: required(GraphQLString) },
    name: { type: GraphQLString },
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    mimeType: { type: GraphQLString },
  },
});

export const McpResourceTemplateType = new GraphQLObjectType({
  name: 'McpResourceTemplate',
  description: 'One resource template a server offers, as MCP resources/templates/list reports it.',
  fields: {
    uriTemplate: { type: required(GraphQLString) },
    name: { type: GraphQLString },
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    mimeType: { type: GraphQLString },
  },
});

export const McpResourceListingType = new GraphQLObjectType({
  name: 'McpResourceListing',
  description: "A server's or workspace's resources and resource templates.",
  fields: {
    resources: { type: listOf(McpResourceType) },
    resourceTemplates: { type: listOf(McpResourceTemplateType) },
  },
});

export const McpPromptArgumentType = new GraphQLObjectType({
  name: 'McpPromptArgument',
  description: 'One argument a prompt takes.',
  fields: {
    name: { type: required(GraphQLString) },
    description: { type: GraphQLString },
    required: { type: GraphQLBoolean },
  },
});

export const McpPromptType = new GraphQLObjectType({
  name: 'McpPrompt',
  description: 'One prompt a server offers, as MCP prompts/list reports it.',
  fields: {
    name: { type: required(GraphQLString) },
    title: { type: GraphQLString },
    description: { type: GraphQLString },
    arguments: { type: new GraphQLList(required(McpPromptArgumentType)) },
  },
});

export const ActivityEntryType = new GraphQLObjectType({
  name: 'ActivityEntry',
  description: 'One proxied MCP call, request and response, as the router recorded it in memory.',
  fields: {
    id: { type: required(GraphQLInt), description: 'Grows with every call; the newest has the largest.' },
    at: { type: required(GraphQLString), description: 'When the call completed, ISO.' },
    via: { type: required(CallViaType) },
    method: { type: required(GraphQLString), description: 'The JSON-RPC method, such as tools/call.' },
    target: { type: GraphQLString, description: 'The tool name, resource URI or prompt name.' },
    ok: { type: required(GraphQLBoolean) },
    durationMs: { type: required(GraphQLFloat) },
    params: { type: GraphQLJSON, description: 'What was sent downstream, possibly cut short.' },
    result: { type: GraphQLJSON, description: 'What came back when ok, possibly cut short.' },
    error: { type: GraphQLString },
  },
});

export const ReloadResultType = new GraphQLObjectType({
  name: 'ReloadResult',
  description: 'What a config reload found.',
  fields: {
    reloaded: { type: required(GraphQLBoolean) },
    serverCount: { type: required(GraphQLInt) },
  },
});

export const OAuthStartType = new GraphQLObjectType({
  name: 'OAuthStart',
  description: 'Where to send the operator to sign a remote server in.',
  fields: {
    authorizationUrl: {
      type: GraphQLString,
      description: "The server's login page, to open in a window; null when no login was needed after all.",
    },
    signedIn: {
      type: required(GraphQLBoolean),
      description: 'The stored sign-in still worked, so there is nothing to open.',
    },
  },
});

export const LanServerType = new GraphQLObjectType({
  name: 'LanServer',
  description: 'A server another host on the local network advertises.',
  fields: {
    key: { type: required(GraphQLString), description: 'Unique on the network: `<mDNS instance>/<card name>`.' },
    cardName: { type: required(GraphQLString) },
    title: { type: GraphQLString },
    description: { type: required(GraphQLString) },
    version: { type: required(GraphQLString) },
    host: { type: required(GraphQLString), description: "The announcing host's mDNS instance name." },
    url: { type: required(GraphQLString), description: 'The streamable-HTTP endpoint to add.' },
    requiredHeaders: { type: listOf(GraphQLString), description: 'Headers to supply before it can be added.' },
    suggestedName: { type: required(GraphQLString), description: 'A local name for it, free in this router.' },
    state: { type: required(LanServerStateType) },
    serverName: { type: GraphQLString, description: 'The local server it was added as.' },
  },
});

export const LanDiscoveryType = new GraphQLObjectType({
  name: 'LanDiscovery',
  description: 'The servers found on the local network.',
  fields: {
    enabled: { type: required(GraphQLBoolean), description: 'Whether the router watches the network.' },
    servers: { type: listOf(LanServerType) },
  },
});

export const RegistryServerPageType = new GraphQLObjectType({
  name: 'RegistryServerPage',
  description: "A page of a registry's servers.",
  fields: {
    servers: { type: listOf(GraphQLJSON), description: 'Registry entries, as the registry API returns them.' },
    nextCursor: { type: GraphQLString, description: 'Pass it back as `cursor` for the next page. Null on the last.' },
  },
});

export const OAuthClientInputType = new GraphQLInputObjectType({
  name: 'OAuthClientInput',
  description: 'A client registered in advance with a remote server whose login only accepts known clients.',
  fields: {
    clientId: { type: required(GraphQLString) },
    clientSecret: { type: GraphQLString, description: 'Left out keeps the stored secret; empty removes it.' },
    scope: { type: GraphQLString },
  },
});

export const InstallServerInputType = new GraphQLInputObjectType({
  name: 'InstallServerInput',
  description: 'What to install. Checked against the same rules as `POST /api/servers`.',
  fields: {
    name: { type: GraphQLString, description: 'The local name and route segment. Derived when left out.' },
    source: {
      type: required(GraphQLJSON),
      description:
        'Where it comes from: `{ type: "registry", registry, serverName }`, `{ type: "npm", package }`, `{ type: "pypi", package }` or `{ type: "remote" }`.',
    },
    packageSelector: { type: GraphQLString, description: 'For a registry entry: which package or remote of it.' },
    transport: { type: GraphQLJSON, description: 'For a remote: `{ type: "streamable-http", url, headers }`.' },
    env: { type: GraphQLJSON, description: 'Env vars for a stdio child, as an object of strings.' },
    enabled: { type: GraphQLBoolean },
    oauthClient: { type: OAuthClientInputType },
    discovered: { type: GraphQLJSON, description: 'For a server found on the network: `{ key, cardName }`.' },
  },
});

export const EditServerInputType = new GraphQLInputObjectType({
  name: 'EditServerInput',
  description: 'An edit to a server. A field left out stays as it is.',
  fields: {
    displayName: { type: GraphQLString },
    description: { type: GraphQLString },
    enabled: { type: GraphQLBoolean },
    env: { type: GraphQLJSON },
    idleTimeoutMs: { type: GraphQLInt, description: 'null clears the override.' },
    transport: { type: GraphQLJSON, description: 'A URL moved to another origin signs the server out.' },
    oauthClient: { type: OAuthClientInputType, description: 'null removes it. A changed client signs the server out.' },
  },
});

export const SaveWorkspaceMemberInputType = new GraphQLInputObjectType({
  name: 'SaveWorkspaceMemberInput',
  description: 'One server in a workspace, with its per-workspace overrides.',
  fields: {
    serverId: { type: required(GraphQLUUID) },
    enabled: { type: GraphQLBoolean },
    env: { type: GraphQLJSON, description: "Merged over the server's env." },
    args: { type: new GraphQLList(required(GraphQLString)), description: "Replaces the server's stdio args." },
    headers: { type: GraphQLJSON, description: "Merged over the server's headers." },
    url: { type: GraphQLString, description: "Replaces the server's URL." },
  },
});

export const SaveWorkspaceInputType = new GraphQLInputObjectType({
  name: 'SaveWorkspaceInput',
  description: 'A workspace and its whole member list.',
  fields: {
    id: { type: GraphQLUUID, description: 'The workspace to replace; left out creates one.' },
    name: { type: required(GraphQLString) },
    slug: {
      type: GraphQLString,
      description: 'The route segment at /mcp/w/<slug>. Derived from the name when left out.',
    },
    enabled: { type: GraphQLBoolean },
    description: { type: GraphQLString },
    members: { type: required(new GraphQLList(required(SaveWorkspaceMemberInputType))) },
  },
});
