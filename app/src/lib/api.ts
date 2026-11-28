import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import {
  apiErrorSchema,
  ErrorCode,
  HttpStatus,
  type PromptGetRequest,
  type RegistryServerEntry,
  type ResourceReadRequest,
  registryServerEntrySchema,
  type ServerConfig,
  type ServerSource,
  type ServerTransport,
  serverConfigSchema,
  type ToolCallRequest,
  type WorkspaceMember,
  workspaceMemberSchema,
} from '@mcp-router/shared';
import { type DocumentNode, print } from 'graphql';
import { graphql } from '@/__generated__/gql';
import type {
  ActivityEntryFieldsFragment,
  ApiKeyFieldsFragment,
  AuthConfigQuery,
  CreateApiKeyMutation,
  EditServerInput,
  InstallServerInput,
  LanDiscoveryFieldsFragment,
  McpPromptFieldsFragment,
  McpPromptMessagesFieldsFragment,
  McpResourceContentsFieldsFragment,
  McpResourceListingFieldsFragment,
  McpToolFieldsFragment,
  McpToolResultFieldsFragment,
  ReloadConfigMutation,
  RouterStatusFieldsFragment,
  SaveWorkspaceInput,
  ServerRowFieldsFragment,
  ServerRuntimeFieldsFragment,
  SsoSetupFieldsFragment,
  StartServerOAuthMutation,
  UpdateSettingInput,
  WorkspaceFieldsFragment,
} from '@/__generated__/graphql';
import { ServerRuntimeState } from '@/__generated__/graphql';
import { PAGE_DEFAULTS } from './defaults.ts';
import { forgetSession, sessionToken } from './session.ts';

// The UI's one client: every read and write goes through /graphql with a typed document.

/** Where the UI sends its GraphQL operations; Vite proxies it to the server in development. */
const GRAPHQL_ENDPOINT = '/graphql';

/** A failed request: the HTTP status, and the server's code and detail when it sent them. */
export class ApiRequestError extends Error {
  /** HTTP status of the answer. A refused GraphQL operation answers 200 and carries its reason in `code`. */
  readonly status: number;
  /** Undefined when the answer said no code (a proxy's own error page, a masked GraphQL error). */
  readonly code?: ErrorCode;
  /** The longer explanation, when the server sent one. */
  readonly detail?: string;

  /**
   * Builds the error from a failed answer.
   *
   * @param status - HTTP status of the answer.
   * @param message - What the server said, or the status text when it said nothing.
   * @param [reason] - The server's `code` and `detail`; omit when it sent neither.
   */
  constructor(status: number, message: string, reason: { code?: ErrorCode; detail?: string } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = reason.code;
    this.detail = reason.detail;
  }
}

/** The codes of a request the caller got wrong, which asking again will not fix. */
const CALLER_ERROR_CODES: ReadonlySet<string> = new Set([
  ErrorCode.BadUserInput,
  ErrorCode.Unauthenticated,
  ErrorCode.Forbidden,
  ErrorCode.NotFound,
  ErrorCode.Conflict,
  ErrorCode.QueryTooComplex,
]);

/**
 * Whether a failure is one a retry would only repeat.
 *
 * @param error - What a request threw.
 * @returns true for a 4xx answer, or an error coded as the caller's mistake.
 */
export function isCallerError(error: unknown): boolean {
  if (error instanceof ApiRequestError === false) {
    return false;
  }
  const isClientStatus = error.status >= HttpStatus.BadRequest && error.status < HttpStatus.InternalServerError;
  return isClientStatus || (error.code !== undefined && CALLER_ERROR_CODES.has(error.code));
}

/** The `code` values the UI knows, for reading one out of an answer. */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/**
 * Reads an error code the server sent.
 *
 * @param value - The answer's `code` or `extensions.code`.
 * @returns The code, or undefined when it is not one the UI knows.
 */
function codeOf(value: unknown): ErrorCode | undefined {
  return typeof value === 'string' && KNOWN_CODES.has(value) ? (value as ErrorCode) : undefined;
}

/**
 * Sends a request with the session as a bearer token and hands back the response once it is known to have succeeded.
 *
 * @param path - Same-origin path.
 * @param init - Method and JSON body.
 * @returns The 2xx response, body unread. Throws `ApiRequestError` on any other status.
 *
 * @remarks
 * A 401 drops the session before it throws, which sends the UI to sign-in.
 */
async function send(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = sessionToken();
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (response.status === HttpStatus.Unauthorized) {
    forgetSession();
  }
  if (response.ok === false) {
    const envelope = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    const statusMessage = response.statusText || `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, envelope.data?.error || statusMessage, {
      code: envelope.data?.code,
      detail: envelope.data?.detail,
    });
  }
  return response;
}

/** One error of a GraphQL answer, as far as the UI reads it. */
interface GraphQLErrorBody {
  message: string;
  extensions?: { code?: unknown; detail?: unknown };
}

/** A GraphQL answer. */
interface GraphQLAnswer<TResult> {
  data?: TResult | null;
  errors?: GraphQLErrorBody[];
}

/**
 * Finds the name of the one operation a document holds.
 *
 * @param document - A document from codegen.
 * @returns Its operation's name; sent beside the query so logs and the story mocks can tell operations apart.
 */
function operationNameOf(document: DocumentNode): string | undefined {
  const operation = document.definitions.find((definition) => definition.kind === 'OperationDefinition');
  return operation?.kind === 'OperationDefinition' ? operation.name?.value : undefined;
}

/**
 * Sends one GraphQL operation, typed by its document.
 *
 * @typeParam TResult - What the operation answers.
 * @typeParam TVariables - What it takes.
 * @param document - The operation, from codegen.
 * @param variables - Its variables.
 * @returns The answer's `data`.
 *
 * @remarks
 * Throws `ApiRequestError` with the first error's message, `extensions.code` and `extensions.detail`. An
 * UNAUTHENTICATED error drops the session, as a 401 does.
 */
async function request<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const operationName = operationNameOf(document);
  const response = await send(GRAPHQL_ENDPOINT, {
    method: 'POST',
    body: { query: print(document), variables, operationName },
  });
  const answer: GraphQLAnswer<TResult> = await response.json();
  const [first] = answer.errors ?? [];
  if (first !== undefined) {
    const code = codeOf(first.extensions?.code);
    if (code === ErrorCode.Unauthenticated) {
      forgetSession();
    }
    const detail = typeof first.extensions?.detail === 'string' ? first.extensions.detail : undefined;
    throw new ApiRequestError(response.status, first.message, { code, detail });
  }
  if (answer.data === undefined || answer.data === null) {
    throw new ApiRequestError(response.status, `${operationName ?? 'The request'} answered with no data`);
  }
  return answer.data;
}

/**
 * Drops an object's nulls, so a nullable column reads as the absent field the shared config schemas expect.
 *
 * @param row - A row as GraphQL answered it.
 * @returns The row without its null fields.
 */
function withoutNulls(row: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

graphql(`
  fragment RouterStatusFields on RouterStatus {
    version
    uptimeSeconds
    serverCount
    runningCount
    authEnabled
    idleTimeoutMs
    publicUrl
    instanceId
    lanAdvertise
    lanDiscovery
  }

  fragment ServerRowFields on Server {
    id
    name
    displayName
    description
    enabled
    source
    transport
    env
    envMeta
    idleTimeoutMs
    callTimeoutMs
    discovered
  }

  fragment ServerRuntimeFields on ServerRuntime {
    name
    state
    pid
    startedAt
    lastError
    toolCount
    callCount
    lastCalledAt
    oauth {
      signedIn
      expiresAt
      refreshable
      clientId
      hasClientSecret
    }
  }

  fragment WorkspaceFields on Workspace {
    id
    name
    slug
    enabled
    description
  }

  fragment WorkspaceMemberFields on WorkspaceMember {
    id
    workspaceId
    serverId
    enabled
    env
    args
    headers
    url
    server {
      name
    }
  }

  fragment McpToolFields on McpTool {
    name
    title
    description
    inputSchema
    outputSchema
    annotations
  }

  fragment McpResourceListingFields on McpResourceListing {
    resources {
      uri
      name
      title
      description
      mimeType
    }
    resourceTemplates {
      uriTemplate
      name
      title
      description
      mimeType
    }
  }

  fragment McpPromptFields on McpPrompt {
    name
    title
    description
    arguments {
      name
      description
      required
    }
  }

  fragment McpToolResultFields on McpToolResult {
    content
    structuredContent
    isError
  }

  fragment McpResourceContentsFields on McpResourceContents {
    contents
  }

  fragment McpPromptMessagesFields on McpPromptMessages {
    description
    messages
  }

  fragment ActivityEntryFields on ActivityEntry {
    id
    at
    via
    method
    target
    ok
    durationMs
    params
    result
    error
  }

  fragment LanDiscoveryFields on LanDiscovery {
    enabled
    servers {
      key
      cardName
      title
      description
      version
      host
      url
      requiredHeaders
      suggestedName
      state
      serverName
    }
  }
`);

/** The router's own status. */
export type RouterStatus = RouterStatusFieldsFragment;
/** A server's live state, as `serverRuntimes` answers it. */
export type ServerRuntime = ServerRuntimeFieldsFragment;
/** One tool a server or workspace offers. */
export type McpTool = McpToolFieldsFragment;
/** A server's or workspace's resources and resource templates. */
export type McpResourceListing = McpResourceListingFieldsFragment;
/** One resource a server offers. */
export type McpResource = McpResourceListing['resources'][number];
/** One resource template a server offers. */
export type McpResourceTemplate = McpResourceListing['resourceTemplates'][number];
/** One prompt a server or workspace offers. */
export type McpPrompt = McpPromptFieldsFragment;
/** What a tool call answered; `isError` marks a tool that reported its own failure. */
export type ToolCallResult = McpToolResultFieldsFragment;
/** What reading a resource answered. */
export type ResourceReadResult = McpResourceContentsFieldsFragment;
/** What getting a prompt answered. */
export type PromptGetResult = McpPromptMessagesFieldsFragment;
/** One recorded proxied call. */
export type ActivityEntry = ActivityEntryFieldsFragment;
/** The servers found on the local network. */
export type LanDiscovery = LanDiscoveryFieldsFragment;
/** A server another host on the local network advertises. */
export type LanServer = LanDiscovery['servers'][number];
/** Where to send the operator to sign a remote server in. */
export type OAuthStartResult = StartServerOAuthMutation['startServerOAuth'];
/** What a config reload found. */
export type ReloadOutcome = ReloadConfigMutation['reloadConfig'];

/** A server's stored config, its JSON columns read through the shared config schema. */
export interface ServerRecord {
  /** The row's id; workspaces name their members by it. */
  id: string;
  config: ServerConfig;
}

/** An installed server: its stored config and its live state. */
export type InstalledServer = ServerRecord & Omit<ServerRuntime, 'name'>;

/**
 * Reads a server row's config.
 *
 * @param row - The row as GraphQL answered it.
 * @returns Its id and config. Throws when a JSON column does not match the shared config schema.
 */
function serverRecordOf(row: ServerRowFieldsFragment): ServerRecord {
  const { id, ...columns } = row;
  return { id, config: serverConfigSchema.parse(withoutNulls(columns)) };
}

/** A server the gateway has not reported on yet: what its runtime reads as until it does. */
const UNREPORTED_RUNTIME: Omit<ServerRuntime, 'name'> = {
  state: ServerRuntimeState.Stopped,
  pid: null,
  startedAt: null,
  lastError: null,
  toolCount: null,
  callCount: null,
  lastCalledAt: null,
  oauth: null,
};

/**
 * Pairs a server row with its live state.
 *
 * @param row - The server's row.
 * @param runtimes - Every server's live state.
 * @returns The installed server; stopped when the gateway has not reported on it.
 */
function installedServerOf(row: ServerRowFieldsFragment, runtimes: ServerRuntime[]): InstalledServer {
  const { name: _name, ...runtime } = runtimes.find((candidate) => candidate.name === row.name) ?? {
    name: row.name,
    ...UNREPORTED_RUNTIME,
  };
  return { ...serverRecordOf(row), ...runtime };
}

/** One server in a workspace: its overrides, and the id of the server it is. */
export type WorkspaceMemberView = WorkspaceMember & { serverId: string };

/** A workspace: its row, its members by server name, and the path it is served at. */
export type WorkspaceView = WorkspaceFieldsFragment & {
  /** Endpoint path of the workspace aggregate, e.g. "/mcp/w/my-workspace". */
  path: string;
  members: Record<string, WorkspaceMemberView>;
};

/** A workspace member as GraphQL answers it. */
type WorkspaceMemberRow = {
  workspaceId: string;
  serverId: string;
  server: { name: string } | null;
} & Record<string, unknown>;

/**
 * Reads a workspace and its members.
 *
 * @param row - The workspace's row.
 * @param members - Its member rows; rows of other workspaces are skipped.
 * @returns The workspace, its members keyed by server name and read through the shared member schema.
 */
function workspaceViewOf(row: WorkspaceFieldsFragment, members: WorkspaceMemberRow[]): WorkspaceView {
  const byName: Record<string, WorkspaceMemberView> = {};
  for (const member of members) {
    if (member.workspaceId !== row.id || member.server === null) {
      continue;
    }
    const { id: _id, workspaceId: _workspaceId, server, serverId, ...overrides } = member;
    byName[server.name] = { ...workspaceMemberSchema.parse(withoutNulls(overrides)), serverId };
  }
  return { ...row, path: `/mcp/w/${row.slug}`, members: byName };
}

/**
 * Builds the member list `saveWorkspace` takes from members keyed by server name.
 *
 * @param members - Each member's overrides and server id.
 * @returns One input per member.
 */
export function memberInputs(members: Record<string, WorkspaceMemberView>): WorkspaceSave['members'] {
  return Object.values(members).map(({ serverId, enabled, env, args, headers, url }) => ({
    serverId,
    enabled,
    ...(env === undefined ? {} : { env }),
    ...(args === undefined ? {} : { args }),
    ...(headers === undefined ? {} : { headers }),
    ...(url === undefined ? {} : { url }),
  }));
}

const RouterStatusQueryDocument = graphql(`
  query RouterStatus {
    routerStatus {
      ...RouterStatusFields
    }
  }
`);

/**
 * Reads the router's own status.
 *
 * @returns Version, uptime, server counts, and whether auth is on.
 */
export async function getStatus(): Promise<RouterStatus> {
  return (await request(RouterStatusQueryDocument, {})).routerStatus;
}

const ServersQueryDocument = graphql(`
  query Servers($limit: Int) {
    servers(limit: $limit, orderBy: { name: { direction: asc, priority: 0 } }) {
      ...ServerRowFields
    }
    serverRuntimes(limit: $limit) {
      ...ServerRuntimeFields
    }
  }
`);

/**
 * Lists every installed server.
 *
 * @returns Each server's config and live state, by name.
 */
export async function listServers(): Promise<InstalledServer[]> {
  const { servers, serverRuntimes } = await request(ServersQueryDocument, { limit: PAGE_DEFAULTS.servers });
  return servers.map((row) => installedServerOf(row, serverRuntimes));
}

const ServerQueryDocument = graphql(`
  query Server($name: String!, $limit: Int) {
    server(where: { name: { eq: $name } }) {
      ...ServerRowFields
    }
    serverRuntimes(limit: $limit) {
      ...ServerRuntimeFields
    }
  }
`);

/**
 * Reads one server.
 *
 * @param name - The server's local name.
 * @returns Its config and live state, or null when there is no such server.
 */
export async function getServer(name: string): Promise<InstalledServer | null> {
  const { server, serverRuntimes } = await request(ServerQueryDocument, { name, limit: PAGE_DEFAULTS.servers });
  return server === null ? null : installedServerOf(server, serverRuntimes);
}

/** What the install form sends: the generated input, with its JSON fields held to the shared config shapes. */
export type InstallInput = InstallServerInput & {
  source: ServerSource;
  transport?: ServerTransport | null;
  env?: Record<string, string> | null;
};

const InstallServerMutationDocument = graphql(`
  mutation InstallServer($input: InstallServerInput!) {
    installServer(input: $input) {
      ...ServerRowFields
    }
  }
`);

/**
 * Installs a server.
 *
 * @param input - What to install and how to configure it.
 * @returns The new server's config.
 */
export async function installServer(input: InstallInput): Promise<ServerRecord> {
  return serverRecordOf((await request(InstallServerMutationDocument, { input })).installServer);
}

/** What the edit form sends: the generated input, with its JSON fields held to the shared config shapes. */
export type EditServerChanges = EditServerInput & {
  env?: Record<string, string> | null;
  transport?: ServerTransport | null;
};

const UpdateServerMutationDocument = graphql(`
  mutation UpdateServer($name: String!, $input: EditServerInput!) {
    updateServer(name: $name, input: $input) {
      ...ServerRowFields
    }
  }
`);

/**
 * Changes a server's config.
 *
 * @param name - The server's local name.
 * @param input - Only the fields to change.
 * @returns The server's config after the change.
 */
export async function updateServer(name: string, input: EditServerChanges): Promise<ServerRecord> {
  return serverRecordOf((await request(UpdateServerMutationDocument, { name, input })).updateServer);
}

const DeleteServerMutationDocument = graphql(`
  mutation DeleteServer($name: String!) {
    deleteServer(name: $name) {
      id
    }
  }
`);

/**
 * Uninstalls a server.
 *
 * @param name - The server's local name.
 */
export async function deleteServer(name: string): Promise<void> {
  await request(DeleteServerMutationDocument, { name });
}

const RestartServerMutationDocument = graphql(`
  mutation RestartServer($name: String!) {
    restartServer(name: $name) {
      ...ServerRuntimeFields
    }
  }
`);

/**
 * Restarts a server.
 *
 * @param name - The server's local name.
 * @returns The server's live state after the restart.
 */
export async function restartServer(name: string): Promise<ServerRuntime> {
  return (await request(RestartServerMutationDocument, { name })).restartServer;
}

const CheckServerOAuthMutationDocument = graphql(`
  mutation CheckServerOAuth($name: String!) {
    checkServerOAuth(name: $name) {
      ...ServerRuntimeFields
    }
  }
`);

/**
 * Asks a remote server whether it wants a sign-in.
 *
 * @param name - The server's local name.
 * @returns Its live state; `NEEDS_AUTH` when it asked for a login.
 */
export async function checkServerOAuth(name: string): Promise<ServerRuntime> {
  return (await request(CheckServerOAuthMutationDocument, { name })).checkServerOAuth;
}

const StartServerOAuthMutationDocument = graphql(`
  mutation StartServerOAuth($name: String!, $origin: String!) {
    startServerOAuth(name: $name, origin: $origin) {
      authorizationUrl
      signedIn
    }
  }
`);

/**
 * Starts a remote server's sign-in.
 *
 * @param name - The server's local name.
 * @param origin - This window's origin, which the sign-in window reports back to.
 * @returns The login page to open, or `signedIn` when none is needed.
 */
export async function startServerOAuth(name: string, origin: string): Promise<OAuthStartResult> {
  return (await request(StartServerOAuthMutationDocument, { name, origin })).startServerOAuth;
}

const SignOutServerOAuthMutationDocument = graphql(`
  mutation SignOutServerOAuth($name: String!) {
    signOutServerOAuth(name: $name) {
      ...ServerRuntimeFields
    }
  }
`);

/**
 * Signs a remote server out.
 *
 * @param name - The server's local name.
 * @returns Its live state after the sign-out.
 */
export async function signOutServerOAuth(name: string): Promise<ServerRuntime> {
  return (await request(SignOutServerOAuthMutationDocument, { name })).signOutServerOAuth;
}

/** The `kind` of a capability scope that is one server. */
export const SCOPE_SERVER = 'server' as const;
/** The `kind` of a capability scope that is a workspace aggregate. */
export const SCOPE_WORKSPACE = 'workspace' as const;

/**
 * Whose capability surface (tools, resources, prompts, activity, test calls) a call is about.
 *
 * @remarks
 * A single server and a workspace answer the same shapes, so one set of functions, hooks and components serves both.
 */
export type CapabilityScope =
  | { kind: typeof SCOPE_SERVER; name: string }
  | { kind: typeof SCOPE_WORKSPACE; slug: string };

const ServerToolsQueryDocument = graphql(`
  query ServerTools($name: String!, $limit: Int) {
    serverTools(name: $name, limit: $limit) {
      ...McpToolFields
    }
  }
`);

const WorkspaceToolsQueryDocument = graphql(`
  query WorkspaceTools($slug: String!, $limit: Int) {
    workspaceTools(slug: $slug, limit: $limit) {
      ...McpToolFields
    }
  }
`);

/**
 * Lists a scope's tools.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The tools.
 */
export async function getTools(scope: CapabilityScope): Promise<{ tools: McpTool[] }> {
  const limit = PAGE_DEFAULTS.capabilities;
  const tools =
    scope.kind === SCOPE_SERVER
      ? (await request(ServerToolsQueryDocument, { name: scope.name, limit })).serverTools
      : (await request(WorkspaceToolsQueryDocument, { slug: scope.slug, limit })).workspaceTools;
  return { tools };
}

const ServerResourcesQueryDocument = graphql(`
  query ServerResources($name: String!, $limit: Int) {
    serverResources(name: $name, limit: $limit) {
      ...McpResourceListingFields
    }
  }
`);

const WorkspaceResourcesQueryDocument = graphql(`
  query WorkspaceResources($slug: String!, $limit: Int) {
    workspaceResources(slug: $slug, limit: $limit) {
      ...McpResourceListingFields
    }
  }
`);

/**
 * Lists a scope's resources.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The resources and resource templates.
 */
export async function getResources(scope: CapabilityScope): Promise<McpResourceListing> {
  const limit = PAGE_DEFAULTS.capabilities;
  return scope.kind === SCOPE_SERVER
    ? (await request(ServerResourcesQueryDocument, { name: scope.name, limit })).serverResources
    : (await request(WorkspaceResourcesQueryDocument, { slug: scope.slug, limit })).workspaceResources;
}

const ServerPromptsQueryDocument = graphql(`
  query ServerPrompts($name: String!, $limit: Int) {
    serverPrompts(name: $name, limit: $limit) {
      ...McpPromptFields
    }
  }
`);

const WorkspacePromptsQueryDocument = graphql(`
  query WorkspacePrompts($slug: String!, $limit: Int) {
    workspacePrompts(slug: $slug, limit: $limit) {
      ...McpPromptFields
    }
  }
`);

/**
 * Lists a scope's prompts.
 *
 * @param scope - The server or workspace; listing may spawn its downstream server(s).
 * @returns The prompts.
 */
export async function getPrompts(scope: CapabilityScope): Promise<{ prompts: McpPrompt[] }> {
  const limit = PAGE_DEFAULTS.capabilities;
  const prompts =
    scope.kind === SCOPE_SERVER
      ? (await request(ServerPromptsQueryDocument, { name: scope.name, limit })).serverPrompts
      : (await request(WorkspacePromptsQueryDocument, { slug: scope.slug, limit })).workspacePrompts;
  return { prompts };
}

const CallServerToolMutationDocument = graphql(`
  mutation CallServerTool($name: String!, $tool: String!, $arguments: JSON) {
    callServerTool(name: $name, tool: $tool, arguments: $arguments) {
      ...McpToolResultFields
    }
  }
`);

const CallWorkspaceToolMutationDocument = graphql(`
  mutation CallWorkspaceTool($slug: String!, $tool: String!, $arguments: JSON) {
    callWorkspaceTool(slug: $slug, tool: $tool, arguments: $arguments) {
      ...McpToolResultFields
    }
  }
`);

/**
 * Calls one tool, recorded in the scope's activity.
 *
 * @param scope - The server or workspace that serves it; a workspace's tool is named `<server>__<tool>`.
 * @param call - The tool and its arguments.
 * @returns The tool's result; `isError` marks a tool that reported its own failure.
 */
export async function callTool(scope: CapabilityScope, call: ToolCallRequest): Promise<ToolCallResult> {
  const variables = { tool: call.name, arguments: call.arguments };
  return scope.kind === SCOPE_SERVER
    ? (await request(CallServerToolMutationDocument, { name: scope.name, ...variables })).callServerTool
    : (await request(CallWorkspaceToolMutationDocument, { slug: scope.slug, ...variables })).callWorkspaceTool;
}

const ReadServerResourceMutationDocument = graphql(`
  mutation ReadServerResource($name: String!, $uri: String!) {
    readServerResource(name: $name, uri: $uri) {
      ...McpResourceContentsFields
    }
  }
`);

const ReadWorkspaceResourceMutationDocument = graphql(`
  mutation ReadWorkspaceResource($slug: String!, $uri: String!) {
    readWorkspaceResource(slug: $slug, uri: $uri) {
      ...McpResourceContentsFields
    }
  }
`);

/**
 * Reads one resource, recorded in the scope's activity.
 *
 * @param scope - The server or workspace that serves it.
 * @param read - Which resource: a listed URI, or one expanded from a template.
 * @returns The resource's contents.
 */
export async function readResource(scope: CapabilityScope, read: ResourceReadRequest): Promise<ResourceReadResult> {
  return scope.kind === SCOPE_SERVER
    ? (await request(ReadServerResourceMutationDocument, { name: scope.name, uri: read.uri })).readServerResource
    : (await request(ReadWorkspaceResourceMutationDocument, { slug: scope.slug, uri: read.uri })).readWorkspaceResource;
}

const GetServerPromptMutationDocument = graphql(`
  mutation GetServerPrompt($name: String!, $prompt: String!, $arguments: JSON) {
    getServerPrompt(name: $name, prompt: $prompt, arguments: $arguments) {
      ...McpPromptMessagesFields
    }
  }
`);

const GetWorkspacePromptMutationDocument = graphql(`
  mutation GetWorkspacePrompt($slug: String!, $prompt: String!, $arguments: JSON) {
    getWorkspacePrompt(slug: $slug, prompt: $prompt, arguments: $arguments) {
      ...McpPromptMessagesFields
    }
  }
`);

/**
 * Renders one prompt, recorded in the scope's activity.
 *
 * @param scope - The server or workspace that serves it.
 * @param get - The prompt and its string arguments.
 * @returns The prompt's messages.
 */
export async function getPrompt(scope: CapabilityScope, get: PromptGetRequest): Promise<PromptGetResult> {
  const variables = { prompt: get.name, arguments: get.arguments };
  return scope.kind === SCOPE_SERVER
    ? (await request(GetServerPromptMutationDocument, { name: scope.name, ...variables })).getServerPrompt
    : (await request(GetWorkspacePromptMutationDocument, { slug: scope.slug, ...variables })).getWorkspacePrompt;
}

const ServerActivityQueryDocument = graphql(`
  query ServerActivity($name: String!, $limit: Int) {
    serverActivity(name: $name, limit: $limit) {
      ...ActivityEntryFields
    }
  }
`);

const WorkspaceActivityQueryDocument = graphql(`
  query WorkspaceActivity($slug: String!, $limit: Int) {
    workspaceActivity(slug: $slug, limit: $limit) {
      ...ActivityEntryFields
    }
  }
`);

/**
 * Reads a scope's proxied-call log.
 *
 * @param scope - The server or workspace.
 * @returns The recorded calls.
 */
export async function getActivity(scope: CapabilityScope): Promise<{ entries: ActivityEntry[] }> {
  const limit = PAGE_DEFAULTS.activity;
  const entries =
    scope.kind === SCOPE_SERVER
      ? (await request(ServerActivityQueryDocument, { name: scope.name, limit })).serverActivity
      : (await request(WorkspaceActivityQueryDocument, { slug: scope.slug, limit })).workspaceActivity;
  return { entries };
}

const ClearServerActivityMutationDocument = graphql(`
  mutation ClearServerActivity($name: String!) {
    clearServerActivity(name: $name)
  }
`);

const ClearWorkspaceActivityMutationDocument = graphql(`
  mutation ClearWorkspaceActivity($slug: String!) {
    clearWorkspaceActivity(slug: $slug)
  }
`);

/**
 * Empties a scope's proxied-call log.
 *
 * @param scope - The server or workspace.
 */
export async function clearActivity(scope: CapabilityScope): Promise<void> {
  if (scope.kind === SCOPE_SERVER) {
    await request(ClearServerActivityMutationDocument, { name: scope.name });
    return;
  }
  await request(ClearWorkspaceActivityMutationDocument, { slug: scope.slug });
}

const RegistriesQueryDocument = graphql(`
  query Registries($limit: Int) {
    registries(limit: $limit, orderBy: { name: { direction: asc, priority: 0 } }) {
      id
      name
      url
    }
  }
`);

/** A configured registry. */
export interface RegistryView {
  id: string;
  name: string;
  url: string;
}

/**
 * Lists the configured registries.
 *
 * @returns Each registry's name and URL.
 */
export async function listRegistries(): Promise<RegistryView[]> {
  return (await request(RegistriesQueryDocument, { limit: PAGE_DEFAULTS.registries })).registries;
}

const CreateRegistryMutationDocument = graphql(`
  mutation CreateRegistry($name: String!, $url: String!) {
    createRegistry(values: { name: $name, url: $url }) {
      id
      name
      url
    }
  }
`);

/**
 * Adds a registry.
 *
 * @param registry - Its name and URL.
 * @returns The registry as saved.
 */
export async function createRegistry(registry: { name: string; url: string }): Promise<RegistryView> {
  return (await request(CreateRegistryMutationDocument, registry)).createRegistry;
}

const DeleteRegistryMutationDocument = graphql(`
  mutation DeleteRegistry($name: String!) {
    deleteRegistry(where: { name: { eq: $name } }) {
      id
    }
  }
`);

/**
 * Removes a registry.
 *
 * @param name - The registry's name.
 */
export async function deleteRegistry(name: string): Promise<void> {
  await request(DeleteRegistryMutationDocument, { name });
}

const RegistryServersQueryDocument = graphql(`
  query RegistryServers($registry: String!, $search: String, $cursor: String, $limit: Int) {
    registryServers(registry: $registry, search: $search, cursor: $cursor, limit: $limit) {
      servers
      nextCursor
    }
  }
`);

/** One page of a registry search. */
export interface RegistryPage {
  /** The entries, read through the shared registry schema. */
  servers: RegistryServerEntry[];
  /** Pass it back for the next page; null on the last. */
  nextCursor: string | null;
}

/**
 * Searches one registry's servers.
 *
 * @param registry - The registry's name.
 * @param [params] - Search text, page cursor and page size; an empty one is left out.
 * @returns One page of entries.
 */
export async function searchRegistryServers(
  registry: string,
  params: { search?: string; cursor?: string; limit?: number } = {},
): Promise<RegistryPage> {
  const { registryServers } = await request(RegistryServersQueryDocument, {
    registry,
    search: params.search || null,
    cursor: params.cursor || null,
    limit: params.limit ?? null,
  });
  return {
    servers: registryServers.servers.map((entry) => registryServerEntrySchema.parse(entry)),
    nextCursor: registryServers.nextCursor,
  };
}

const WorkspacesQueryDocument = graphql(`
  query Workspaces($limit: Int, $memberLimit: Int) {
    workspaces(limit: $limit, orderBy: { name: { direction: asc, priority: 0 } }) {
      ...WorkspaceFields
    }
    workspaceMembers(limit: $memberLimit) {
      ...WorkspaceMemberFields
    }
  }
`);

/**
 * Lists every workspace.
 *
 * @returns Each workspace with its members and endpoint path.
 */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const { workspaces, workspaceMembers } = await request(WorkspacesQueryDocument, {
    limit: PAGE_DEFAULTS.workspaces,
    memberLimit: PAGE_DEFAULTS.workspaceMembers,
  });
  return workspaces.map((row) => workspaceViewOf(row, workspaceMembers));
}

const WorkspaceQueryDocument = graphql(`
  query Workspace($slug: String!, $memberLimit: Int) {
    workspace(where: { slug: { eq: $slug } }) {
      ...WorkspaceFields
      members(limit: $memberLimit) {
        ...WorkspaceMemberFields
      }
    }
  }
`);

/**
 * Reads one workspace.
 *
 * @param slug - The workspace's slug.
 * @returns It with its members and endpoint path, or null when there is no such workspace.
 */
export async function getWorkspace(slug: string): Promise<WorkspaceView | null> {
  const { workspace } = await request(WorkspaceQueryDocument, { slug, memberLimit: PAGE_DEFAULTS.workspaceMembers });
  if (workspace === null) {
    return null;
  }
  const { members, ...row } = workspace;
  return workspaceViewOf(row, members);
}

const SaveWorkspaceMutationDocument = graphql(`
  mutation SaveWorkspace($input: SaveWorkspaceInput!, $memberLimit: Int) {
    saveWorkspace(input: $input) {
      ...WorkspaceFields
      members(limit: $memberLimit) {
        ...WorkspaceMemberFields
      }
    }
  }
`);

/** What saving a workspace sends: the generated input, with each member's JSON overrides held to the shared shape. */
export type WorkspaceSave = Omit<SaveWorkspaceInput, 'members'> & {
  members: Array<SaveWorkspaceInput['members'][number] & Pick<WorkspaceMember, 'env' | 'headers'>>;
};

/**
 * Builds the save that writes a workspace back as it is, for a change to one part of it.
 *
 * @param workspace - The workspace as read.
 * @returns The input that replaces it with itself; spread a change over it.
 */
export function workspaceSaveOf(workspace: WorkspaceView): WorkspaceSave {
  const { id, name, slug, enabled, description, members } = workspace;
  return { id, name, slug, enabled, description, members: memberInputs(members) };
}

/**
 * Creates a workspace, or replaces one (with `id`), with its whole member list.
 *
 * @param input - The workspace and every member it keeps.
 * @returns The workspace as saved.
 */
export async function saveWorkspace(input: WorkspaceSave): Promise<WorkspaceView> {
  const { saveWorkspace: saved } = await request(SaveWorkspaceMutationDocument, {
    input,
    memberLimit: PAGE_DEFAULTS.workspaceMembers,
  });
  const { members, ...row } = saved;
  return workspaceViewOf(row, members);
}

const DeleteWorkspaceMutationDocument = graphql(`
  mutation DeleteWorkspace($slug: String!) {
    deleteWorkspace(where: { slug: { eq: $slug } }) {
      id
    }
  }
`);

/**
 * Deletes a workspace.
 *
 * @param slug - The workspace's slug.
 */
export async function deleteWorkspace(slug: string): Promise<void> {
  await request(DeleteWorkspaceMutationDocument, { slug });
}

/** The settings the UI edits. */
export type SettingsChanges = Pick<UpdateSettingInput, 'idleTimeoutMs' | 'publicUrl' | 'lanAdvertise' | 'lanDiscovery'>;

const UpdateSettingMutationDocument = graphql(`
  mutation UpdateSetting($set: UpdateSettingInput!) {
    updateSetting(set: $set, where: { id: { eq: 1 } }) {
      idleTimeoutMs
      publicUrl
      lanAdvertise
      lanDiscovery
    }
  }
`);

/** The editable settings as they stand after a change. */
export interface SavedSettings {
  idleTimeoutMs: number;
  publicUrl: string | null;
  lanAdvertise: boolean;
  lanDiscovery: boolean;
}

/**
 * Changes router settings.
 *
 * @param set - Only the settings to change; a null `publicUrl` clears it.
 * @returns The settings after the change.
 */
export async function updateSettings(set: SettingsChanges): Promise<SavedSettings> {
  const { updateSetting } = await request(UpdateSettingMutationDocument, { set });
  if (updateSetting === null) {
    throw new ApiRequestError(HttpStatus.Ok, 'The router has no settings to change', { code: ErrorCode.NotFound });
  }
  return updateSetting;
}

const ReloadConfigMutationDocument = graphql(`
  mutation ReloadConfig {
    reloadConfig {
      reloaded
      serverCount
    }
  }
`);

/**
 * Makes the router re-read its stored config.
 *
 * @returns Whether it reloaded, and the server count afterwards.
 */
export async function reloadConfig(): Promise<ReloadOutcome> {
  return (await request(ReloadConfigMutationDocument, {})).reloadConfig;
}

const LanServersQueryDocument = graphql(`
  query LanServers($limit: Int) {
    lanServers(limit: $limit) {
      ...LanDiscoveryFields
    }
  }
`);

/**
 * Lists the servers found on the local network.
 *
 * @returns Whether the router is watching, and each found server with whether it is available, added or dismissed.
 */
export async function getDiscovery(): Promise<LanDiscovery> {
  return (await request(LanServersQueryDocument, { limit: PAGE_DEFAULTS.lanServers })).lanServers;
}

const SetLanServerDismissedMutationDocument = graphql(`
  mutation SetLanServerDismissed($key: String!, $dismissed: Boolean!, $limit: Int) {
    setLanServerDismissed(key: $key, dismissed: $dismissed, limit: $limit) {
      ...LanDiscoveryFields
    }
  }
`);

/**
 * Hides a found server, or offers it again.
 *
 * @param change - Its discovery key, and whether it is dismissed.
 * @returns The found servers afterwards.
 */
export async function setDismissed(change: { key: string; dismissed: boolean }): Promise<LanDiscovery> {
  return (await request(SetLanServerDismissedMutationDocument, { ...change, limit: PAGE_DEFAULTS.lanServers }))
    .setLanServerDismissed;
}

// Sign-in and API keys. The sign-in operations are answered signed out; the rest are the operator's.

graphql(`
  fragment SsoSetupFields on SsoSetup {
    source
    issuer
    name
    canPair
    redirectUri
  }

  fragment ApiKeyFields on ApiKey {
    id
    name
    start
    createdAt
    lastUsedAt
    expiresAt
  }
`);

/** How the sign-in page may sign someone in: the trusted network, the provider, and whether pairing is allowed. */
export type AuthConfig = AuthConfigQuery;

/** How sign-in through an OIDC provider is set up, and whether the operator may change it. */
export type SsoSetup = SsoSetupFieldsFragment;

/** An API key, without its secret. */
export type ApiKey = ApiKeyFieldsFragment;

/** An API key as it is made, with its secret: the only time the secret is seen. */
export type CreatedApiKey = CreateApiKeyMutation['createApiKey'];

const AuthConfigQueryDocument = graphql(`
  query AuthConfig {
    authConfig {
      trustedNetwork
      sso {
        name
        signInUrl
      }
    }
    ssoSetup {
      source
      canPair
      redirectUri
    }
  }
`);

/**
 * Reads how the sign-in page may sign someone in. Answered signed out.
 *
 * @returns The trusted-network flag, the provider to offer, and whether a provider may be paired.
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  return request(AuthConfigQueryDocument, {});
}

const SignInOnTrustedNetworkMutationDocument = graphql(`
  mutation SignInOnTrustedNetwork {
    signInOnTrustedNetwork {
      token
      userId
    }
  }
`);

/**
 * Signs whoever opened the UI in as the local admin. Only on a trusted network (`SECURE_LOCAL_NET`).
 *
 * @returns The session token to keep.
 */
export async function signInOnTrustedNetwork(): Promise<string> {
  return (await request(SignInOnTrustedNetworkMutationDocument, {})).signInOnTrustedNetwork.token;
}

const VerifyOneTimeTokenMutationDocument = graphql(`
  mutation VerifyOneTimeToken($token: String!) {
    verifyOneTimeToken(token: $token) {
      token
      userId
    }
  }
`);

/**
 * Spends the one-time token a provider sign-in came back with, for a session.
 *
 * @param token - The one-time token from the callback's URL.
 * @returns The session token to keep.
 */
export async function verifyOneTimeToken(token: string): Promise<string> {
  return (await request(VerifyOneTimeTokenMutationDocument, { token })).verifyOneTimeToken.token;
}

const SignOutMutationDocument = graphql(`
  mutation SignOut {
    signOut {
      success
    }
  }
`);

/**
 * Ends the session on the server.
 *
 * @returns Nothing; the caller forgets the token whatever the server said.
 */
export async function signOut(): Promise<void> {
  await request(SignOutMutationDocument, {});
}

const SsoSetupQueryDocument = graphql(`
  query SsoSetup {
    ssoSetup {
      ...SsoSetupFields
    }
  }
`);

/**
 * Reads how sign-in through an OIDC provider is set up.
 *
 * @returns Where the provider comes from, its name, whether it may be changed, and the redirect URI.
 */
export async function getSsoSetup(): Promise<SsoSetup> {
  return (await request(SsoSetupQueryDocument, {})).ssoSetup;
}

const PairSsoMutationDocument = graphql(`
  mutation PairSso($setupUrl: String!) {
    pairSso(setupUrl: $setupUrl) {
      ...SsoSetupFields
    }
  }
`);

/**
 * Pairs the router with the provider a setup URL names.
 *
 * @param setupUrl - The URL the provider gave, trimmed.
 * @returns How sign-in is set up afterwards.
 */
export async function pairSso(setupUrl: string): Promise<SsoSetup> {
  return (await request(PairSsoMutationDocument, { setupUrl })).pairSso;
}

const UnpairSsoMutationDocument = graphql(`
  mutation UnpairSso {
    unpairSso {
      ...SsoSetupFields
    }
  }
`);

/**
 * Disconnects the paired provider, so the sign-in page stops offering it.
 *
 * @returns How sign-in is set up afterwards.
 */
export async function unpairSso(): Promise<SsoSetup> {
  return (await request(UnpairSsoMutationDocument, {})).unpairSso;
}

const ApiKeysQueryDocument = graphql(`
  query ApiKeys {
    apiKeys {
      ...ApiKeyFields
    }
  }
`);

/**
 * Lists the operator's API keys.
 *
 * @returns Every key, without its secret.
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  return (await request(ApiKeysQueryDocument, {})).apiKeys;
}

const CreateApiKeyMutationDocument = graphql(`
  mutation CreateApiKey($name: String!) {
    createApiKey(name: $name) {
      apiKey {
        ...ApiKeyFields
      }
      key
    }
  }
`);

/**
 * Makes an API key.
 *
 * @param name - What the key is called, trimmed.
 * @returns The key, with its secret.
 */
export async function createApiKey(name: string): Promise<CreatedApiKey> {
  return (await request(CreateApiKeyMutationDocument, { name })).createApiKey;
}

const RevokeApiKeyMutationDocument = graphql(`
  mutation RevokeApiKey($id: UUID!) {
    revokeApiKey(id: $id)
  }
`);

/**
 * Revokes an API key, so a client sending it is refused.
 *
 * @param id - The key's id.
 * @returns Nothing.
 */
export async function revokeApiKey(id: string): Promise<void> {
  await request(RevokeApiKeyMutationDocument, { id });
}
