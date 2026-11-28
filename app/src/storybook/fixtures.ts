import {
  type PromptGetResponse,
  promptGetResponseSchema,
  type RegistryServer,
  type ResourceReadResponse,
  registryServerEntrySchema,
  registryServerSchema,
  resourceReadResponseSchema,
  serverConfigSchema,
  type ToolCallResponse,
  toolCallResponseSchema,
  workspaceMemberSchema,
} from '@mcp-router/shared';
import {
  CallVia,
  LanServerState,
  type LanServersQuery,
  type McpToolFieldsFragment,
  type RegistryServersQuery,
  type ServerQuery,
  type ServerRowFieldsFragment,
  type ServerRuntimeFieldsFragment,
  ServerRuntimeState,
  type ServersQuery,
  type WorkspaceFieldsFragment,
  type WorkspaceMemberFieldsFragment,
  type WorkspaceQuery,
  type WorkspacesQuery,
} from '@/__generated__/graphql';
import type {
  ActivityEntry,
  InstalledServer,
  LanDiscovery,
  LanServer,
  McpPrompt,
  McpResourceListing,
  McpTool,
  OAuthStartResult,
  RegistryView,
  ReloadOutcome,
  RouterStatus,
  SavedSettings,
  WorkspaceView,
} from '@/lib/api';
import type { ApiRoutes } from './mock-api.ts';

// Each builder returns what the app reads (an InstalledServer, a WorkspaceView), its JSON parts read through the
// shared config schemas. The `…Answer` and row helpers turn those into GraphQL `data`, which the mock runs through
// the real schema, so a story's server cannot answer with something the real one would not.

/** The id of the `filesystem` fixture server. */
export const FILESYSTEM_ID = '00000000-0000-4000-8000-000000000001';
/** The id of the `docs` fixture server. */
export const DOCS_ID = '00000000-0000-4000-8000-000000000002';
/** The id of the `research` fixture workspace. */
export const RESEARCH_ID = '00000000-0000-4000-8000-0000000000a1';

/** The ids the fixture servers are known by; any other name is given the next free one the first time it is asked. */
const SERVER_IDS = new Map<string, string>([
  ['filesystem', FILESYSTEM_ID],
  ['docs', DOCS_ID],
]);

/** How many hex digits the last group of a uuid has. */
const UUID_LAST_GROUP_LENGTH = 12;
/** Uuids are written in hex. */
const HEX = 16;

/**
 * Builds a fixture uuid from a number.
 *
 * @param n - What tells it apart.
 * @returns `00000000-0000-4000-8000-` and `n` in hex, padded.
 */
function fixtureUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(HEX).padStart(UUID_LAST_GROUP_LENGTH, '0')}`;
}

/** Where the ids of workspace members start, clear of the servers'. */
const MEMBER_ID_BASE = 0x1000;

/**
 * Gives a fixture server its id.
 *
 * @param name - The server's name.
 * @returns A uuid that is the same every time for the same name.
 */
export function serverId(name: string): string {
  const known = SERVER_IDS.get(name);
  if (known !== undefined) {
    return known;
  }
  const id = fixtureUuid(SERVER_IDS.size + 1);
  SERVER_IDS.set(name, id);
  return id;
}

/** A server's runtime fields, all unreported. */
const NO_RUNTIME = {
  pid: null,
  startedAt: null,
  lastError: null,
  toolCount: null,
  callCount: null,
  lastCalledAt: null,
  oauth: null,
} as const;

/** What a server fixture takes: any part of the server to replace, and `name` for the config's name. */
type ServerOverrides = Partial<InstalledServer> & { name?: string };

/**
 * Builds a running stdio server installed from npm.
 *
 * @param [overrides] - Any part of the server to replace; `name` sets the config's name.
 * @returns The server, its config parsed through the shared schema.
 */
export function stdioServer(overrides: ServerOverrides = {}): InstalledServer {
  const { name = 'filesystem', ...status } = overrides;
  return {
    id: serverId(name),
    config: serverConfigSchema.parse({
      name,
      displayName: 'Filesystem',
      description: 'Read and write files under one folder.',
      enabled: true,
      source: { type: 'npm', package: '@modelcontextprotocol/server-filesystem' },
      transport: { type: 'stdio', command: 'node', args: ['index.js', '/tmp'] },
      env: { ROOT_DIR: '/tmp' },
      envMeta: { ROOT_DIR: { description: 'The folder the server may touch.', isRequired: true } },
    }),
    ...NO_RUNTIME,
    state: ServerRuntimeState.Running,
    toolCount: 3,
    callCount: 12,
    lastCalledAt: '2026-10-01T12:00:00.000Z',
    ...status,
  };
}

/**
 * Builds a stopped remote server reached over streamable HTTP.
 *
 * @param [overrides] - Any part of the server to replace; `name` sets the config's name.
 * @returns The server, its config parsed through the shared schema.
 */
export function remoteServer(overrides: ServerOverrides = {}): InstalledServer {
  const { name = 'docs', ...status } = overrides;
  return {
    id: serverId(name),
    config: serverConfigSchema.parse({
      name,
      enabled: true,
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://docs.example.test/mcp', headers: {} },
      env: {},
      envMeta: {},
    }),
    ...NO_RUNTIME,
    state: ServerRuntimeState.Stopped,
    ...status,
  };
}

/**
 * Builds a remote server that asked for an OAuth login nobody has done yet.
 *
 * @param [overrides] - Any part of the server to replace; `name` sets the config's name.
 * @returns The server.
 */
export function needsSignInServer(overrides: ServerOverrides = {}): InstalledServer {
  return remoteServer({
    name: 'home-assistant',
    state: ServerRuntimeState.NeedsAuth,
    oauth: { signedIn: false, expiresAt: null, refreshable: false, clientId: null, hasClientSecret: false },
    ...overrides,
  });
}

/**
 * Builds a remote server the router is signed in to, with a refreshable token.
 *
 * @param [overrides] - Any part of the server to replace; `name` sets the config's name.
 * @returns The server.
 */
export function signedInServer(overrides: ServerOverrides = {}): InstalledServer {
  return remoteServer({
    name: 'home-assistant',
    state: ServerRuntimeState.Running,
    toolCount: 4,
    oauth: {
      signedIn: true,
      refreshable: true,
      expiresAt: '2026-10-01T13:00:00.000Z',
      clientId: null,
      hasClientSecret: false,
    },
    ...overrides,
  });
}

/**
 * Turns a server into its row, as `servers` and the server mutations answer it.
 *
 * @param server - The server.
 * @returns The row; an absent optional column is null.
 */
export function serverRow(server: InstalledServer): ServerRowFieldsFragment {
  const { config } = server;
  return {
    id: server.id,
    name: config.name,
    displayName: config.displayName ?? null,
    description: config.description ?? null,
    enabled: config.enabled,
    source: config.source,
    transport: config.transport,
    env: config.env,
    envMeta: config.envMeta,
    idleTimeoutMs: config.idleTimeoutMs ?? null,
    callTimeoutMs: config.callTimeoutMs ?? null,
    discovered: config.discovered ?? null,
  };
}

/**
 * Turns a server into its live state, as `serverRuntimes` and the runtime mutations answer it.
 *
 * @param server - The server.
 * @returns Its runtime.
 */
export function serverRuntime(server: InstalledServer): ServerRuntimeFieldsFragment {
  const { state, pid, startedAt, lastError, toolCount, callCount, lastCalledAt, oauth } = server;
  return { name: server.config.name, state, pid, startedAt, lastError, toolCount, callCount, lastCalledAt, oauth };
}

/**
 * Builds the answer to the server list.
 *
 * @param servers - The servers.
 * @returns The `Servers` data.
 */
export function serversAnswer(servers: InstalledServer[]): ServersQuery {
  return { servers: servers.map(serverRow), serverRuntimes: servers.map(serverRuntime) };
}

/**
 * Builds the answer to one server's page.
 *
 * @param server - The server, or null for one that does not exist.
 * @returns The `Server` data.
 */
export function serverAnswer(server: InstalledServer | null): ServerQuery {
  return server === null
    ? { server: null, serverRuntimes: [] }
    : { server: serverRow(server), serverRuntimes: [serverRuntime(server)] };
}

/**
 * Builds the answer to starting a sign-in: the login page to open.
 *
 * @param [overrides] - Any part of the answer to replace.
 * @returns The answer.
 */
export function oauthStart(overrides: Partial<OAuthStartResult> = {}): OAuthStartResult {
  return { signedIn: false, authorizationUrl: 'about:blank#login', ...overrides };
}

/**
 * Builds the router's own status, with auth off.
 *
 * @param [overrides] - Any part of the status to replace.
 * @returns The status of a router with two servers, one running.
 */
export function routerStatus(overrides: Partial<RouterStatus> = {}): RouterStatus {
  return {
    version: '2.7.1',
    uptimeSeconds: 3600,
    serverCount: 2,
    runningCount: 1,
    authEnabled: false,
    idleTimeoutMs: 300_000,
    publicUrl: null,
    instanceId: 'nas',
    lanAdvertise: false,
    lanDiscovery: true,
    ...overrides,
  };
}

/**
 * Builds a workspace of the two fixture servers, the second switched off.
 *
 * @param [overrides] - Any part of the workspace to replace; its members are read through the shared member schema.
 * @returns The `research` workspace.
 */
export function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  const { members: memberOverrides, ...rest } = overrides;
  const members = memberOverrides ?? {
    filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' }, serverId: FILESYSTEM_ID },
    docs: { enabled: false, serverId: DOCS_ID },
  };
  const slug = rest.slug ?? 'research';
  return {
    id: RESEARCH_ID,
    name: 'Research',
    slug,
    enabled: true,
    description: 'Files and docs for the research agent.',
    path: `/mcp/w/${slug}`,
    ...rest,
    members: Object.fromEntries(
      Object.entries(members).map(([name, member]) => [
        name,
        { ...workspaceMemberSchema.parse(member), serverId: member.serverId },
      ]),
    ),
  };
}

/**
 * Turns a workspace into its row.
 *
 * @param view - The workspace.
 * @returns The row.
 */
export function workspaceRow(view: WorkspaceView): WorkspaceFieldsFragment {
  const { id, name, slug, enabled, description } = view;
  return { id, name, slug, enabled, description };
}

/**
 * Turns a workspace's members into their rows.
 *
 * @param view - The workspace.
 * @returns One row per member, naming its server.
 */
export function workspaceMemberRows(view: WorkspaceView): WorkspaceMemberFieldsFragment[] {
  return Object.entries(view.members).map(([name, member], index) => ({
    id: fixtureUuid(MEMBER_ID_BASE + index),
    workspaceId: view.id,
    serverId: member.serverId,
    enabled: member.enabled,
    env: member.env ?? null,
    args: member.args ?? null,
    headers: member.headers ?? null,
    url: member.url ?? null,
    server: { name },
  }));
}

/**
 * Builds the answer to the workspace list.
 *
 * @param views - The workspaces.
 * @returns The `Workspaces` data.
 */
export function workspacesAnswer(views: WorkspaceView[]): WorkspacesQuery {
  return { workspaces: views.map(workspaceRow), workspaceMembers: views.flatMap(workspaceMemberRows) };
}

/**
 * Turns a workspace into the row with members that `workspace` and `saveWorkspace` answer.
 *
 * @param view - The workspace.
 * @returns The row and its members.
 */
export function workspaceRecord(view: WorkspaceView): NonNullable<WorkspaceQuery['workspace']> {
  return { ...workspaceRow(view), members: workspaceMemberRows(view) };
}

/**
 * Builds the answer to one workspace's page.
 *
 * @param view - The workspace, or null for one that does not exist.
 * @returns The `Workspace` data.
 */
export function workspaceAnswer(view: WorkspaceView | null): WorkspaceQuery {
  return { workspace: view === null ? null : workspaceRecord(view) };
}

/**
 * Builds the official registry.
 *
 * @param [overrides] - Any part of the registry to replace.
 * @returns The registry.
 */
export function registry(overrides: Partial<RegistryView> = {}): RegistryView {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    name: 'official',
    url: 'https://registry.modelcontextprotocol.io',
    ...overrides,
  };
}

/**
 * Builds one page of a registry search.
 *
 * @returns Two entries, an npm package with an env var to fill in and a remote, and no next cursor.
 */
export function registryPage(): RegistryServersQuery['registryServers'] {
  const entries = [
    {
      server: {
        name: 'io.github.example/weather',
        title: 'Weather',
        description: 'Forecasts for any city.',
        version: '1.2.0',
        repository: { url: 'https://github.com/example/weather', source: 'github' },
        packages: [
          {
            registryType: 'npm',
            identifier: '@example/weather-mcp',
            version: '1.2.0',
            transport: { type: 'stdio' },
            environmentVariables: [
              { name: 'WEATHER_API_KEY', description: 'Key for the forecast API.', isRequired: true, isSecret: true },
            ],
          },
        ],
      },
    },
    {
      server: {
        name: 'io.github.example/notes',
        title: 'Notes',
        description: 'A hosted notebook.',
        version: '0.4.0',
        remotes: [{ type: 'streamable-http', url: 'https://notes.example.test/mcp' }],
      },
    },
  ];
  return { servers: entries.map((entry) => registryServerEntrySchema.parse(entry)), nextCursor: null };
}

/**
 * Builds a registry search that matched nothing.
 *
 * @returns A page with no entries and no next cursor.
 */
export function emptyRegistryPage(): RegistryServersQuery['registryServers'] {
  return { servers: [], nextCursor: null };
}

/**
 * Builds one recorded call.
 *
 * @param [overrides] - Any part of the entry to replace.
 * @returns A successful direct `tools/call` of `read_file`.
 */
export function activityEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    at: '2026-10-01T12:00:00.000Z',
    via: CallVia.Direct,
    method: 'tools/call',
    target: 'read_file',
    ok: true,
    durationMs: 42,
    params: { name: 'read_file', arguments: { path: '/tmp/notes.txt' } },
    result: { content: [{ type: 'text', text: 'hello' }] },
    error: null,
    ...overrides,
  };
}

/**
 * Builds one tool, as tools/list reports it.
 *
 * @param tool - Its name, and any other part to set.
 * @returns The tool; what it does not set is null.
 */
function mcpTool(tool: Partial<McpToolFieldsFragment> & { name: string }): McpTool {
  return { title: null, description: null, inputSchema: null, outputSchema: null, annotations: null, ...tool };
}

/** The tools, resources and prompts a fixture server lists. */
export const capabilities: { tools: McpTool[]; resources: McpResourceListing; prompts: McpPrompt[] } = {
  tools: [
    mcpTool({
      name: 'read_file',
      description: 'Read one file.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'The file to read.' } },
        required: ['path'],
      },
    }),
    mcpTool({ name: 'list_files', description: 'List a folder.', inputSchema: { type: 'object', properties: {} } }),
  ],
  resources: {
    resources: [
      { uri: 'file:///tmp/notes.txt', name: 'notes.txt', title: null, description: null, mimeType: 'text/plain' },
    ],
    resourceTemplates: [],
  },
  prompts: [
    {
      name: 'summarise',
      title: null,
      description: 'Summarise a file.',
      arguments: [{ name: 'path', description: 'The file to summarise.', required: true }],
    },
  ],
};

/**
 * Builds a tools listing.
 *
 * @param [tools] - The tools; the fixture tools when left out.
 * @returns `read_file`, which takes a path, and `list_files`, which takes nothing.
 */
export function toolsResponse(tools: McpTool[] = capabilities.tools): McpTool[] {
  return tools;
}

/**
 * Builds a resources listing.
 *
 * @param [overrides] - Any part of the listing to replace.
 * @returns One text file and one template with a placeholder to fill in.
 */
export function resourcesResponse(overrides: Partial<McpResourceListing> = {}): McpResourceListing {
  return {
    ...capabilities.resources,
    resourceTemplates: [
      {
        uriTemplate: 'file:///tmp/{name}',
        name: 'any file',
        title: null,
        description: 'Any file under /tmp.',
        mimeType: null,
      },
    ],
    ...overrides,
  };
}

/**
 * Builds a prompts listing.
 *
 * @param [prompts] - The prompts; the fixture prompts when left out.
 * @returns `summarise`, which requires a path.
 */
export function promptsResponse(prompts: McpPrompt[] = capabilities.prompts): McpPrompt[] {
  return prompts;
}

/** The answers about one server's or workspace's tools, resources, prompts and activity. */
interface CapabilityAnswers {
  tools?: McpTool[];
  resources?: McpResourceListing;
  prompts?: McpPrompt[];
  activity?: ActivityEntry[];
}

/**
 * Builds the answers to a server's capability tabs.
 *
 * @param [answers] - The listings to answer with; the fixture listings for any left out.
 * @returns `ServerTools`, `ServerResources`, `ServerPrompts` and `ServerActivity`, for any server.
 */
export function serverCapabilityAnswers(answers: CapabilityAnswers = {}): ApiRoutes {
  return {
    ServerTools: { serverTools: answers.tools ?? capabilities.tools },
    ServerResources: { serverResources: answers.resources ?? capabilities.resources },
    ServerPrompts: { serverPrompts: answers.prompts ?? capabilities.prompts },
    ServerActivity: { serverActivity: answers.activity ?? [activityEntry()] },
  };
}

/**
 * Builds the answers to a workspace's capability tabs.
 *
 * @param [answers] - The listings to answer with; the fixture listings for any left out.
 * @returns `WorkspaceTools`, `WorkspaceResources`, `WorkspacePrompts` and `WorkspaceActivity`, for any workspace.
 */
export function workspaceCapabilityAnswers(answers: CapabilityAnswers = {}): ApiRoutes {
  return {
    WorkspaceTools: { workspaceTools: answers.tools ?? capabilities.tools },
    WorkspaceResources: { workspaceResources: answers.resources ?? capabilities.resources },
    WorkspacePrompts: { workspacePrompts: answers.prompts ?? capabilities.prompts },
    WorkspaceActivity: { workspaceActivity: answers.activity ?? [activityEntry()] },
  };
}

/** A GraphQL operation's variables, as the mock hands them to an answer function. */
interface AnswerRequest {
  body: unknown;
}

/**
 * Reads one string variable an operation was sent.
 *
 * @param request - What the mock was asked.
 * @param name - The variable.
 * @returns Its value, or `''` when it was not a string.
 */
export function variable(request: AnswerRequest, name: string): string {
  const value = (request.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Builds the answers of a router with the two fixture servers, one workspace and one registry.
 *
 * @returns A fresh answer map, enough for any page to load.
 *
 * @remarks
 * Spread it into a story's `parameters.api` and override what the story is about. `Server` and `Workspace` answer
 * by the name or slug asked for, and with null for any other.
 */
export function appRoutes(): ApiRoutes {
  const servers = [stdioServer(), remoteServer()];
  const workspaces = [workspace()];
  return {
    RouterStatus: { routerStatus: routerStatus() },
    Servers: serversAnswer(servers),
    Server: (request: AnswerRequest) =>
      serverAnswer(servers.find((server) => server.config.name === variable(request, 'name')) ?? null),
    Workspaces: workspacesAnswer(workspaces),
    Workspace: (request: AnswerRequest) =>
      workspaceAnswer(workspaces.find((view) => view.slug === variable(request, 'slug')) ?? null),
    Registries: { registries: [registry()] },
    RegistryServers: { registryServers: registryPage() },
    LanServers: { lanServers: discovery({ servers: [] }) },
    ...serverCapabilityAnswers(),
    ...workspaceCapabilityAnswers(),
  };
}

/**
 * Builds what a tool call returned. The tool runner still calls REST: there is no GraphQL field for it yet.
 *
 * @param [overrides] - Any part of the result to replace; pass `isError` for a tool that reported a failure.
 * @returns One line of text.
 */
export function toolCallResult(overrides: Partial<ToolCallResponse> = {}): ToolCallResponse {
  return toolCallResponseSchema.parse({ content: [{ type: 'text', text: 'hello from notes.txt' }], ...overrides });
}

/**
 * Builds what reading a resource returned. Still REST, like the tool runner.
 *
 * @param [overrides] - Any part of the result to replace; the result must still pass the shared schema.
 * @returns The text of the fixture file.
 */
export function resourceReadResult(overrides: Partial<ResourceReadResponse> = {}): ResourceReadResponse {
  return resourceReadResponseSchema.parse({
    contents: [{ uri: 'file:///tmp/notes.txt', mimeType: 'text/plain', text: 'hello from notes.txt' }],
    ...overrides,
  });
}

/**
 * Builds what getting a prompt returned. Still REST, like the tool runner.
 *
 * @param [overrides] - Any part of the result to replace; the result must still pass the shared schema.
 * @returns One user message.
 */
export function promptGetResult(overrides: Partial<PromptGetResponse> = {}): PromptGetResponse {
  return promptGetResponseSchema.parse({
    description: 'Summarise a file.',
    messages: [{ role: 'user', content: { type: 'text', text: 'Summarise /tmp/notes.txt in one line.' } }],
    ...overrides,
  });
}

/**
 * Builds what `updateSetting` answers once the idle timeout is saved.
 *
 * @param [overrides] - Any part of the answer to replace.
 * @returns The saved settings.
 */
export function settingsResult(overrides: Partial<SavedSettings> = {}): SavedSettings {
  return { idleTimeoutMs: 300_000, publicUrl: null, lanAdvertise: false, lanDiscovery: true, ...overrides };
}

/**
 * Builds what `reloadConfig` answers.
 *
 * @param [overrides] - Any part of the answer to replace.
 * @returns A successful reload that left the two fixture servers.
 */
export function reloadResult(overrides: Partial<ReloadOutcome> = {}): ReloadOutcome {
  return { reloaded: true, serverCount: 2, ...overrides };
}

/**
 * Builds one registry entry.
 *
 * @param [overrides] - Any part of the entry to replace; the result must still pass the shared schema.
 * @returns The npm package of `registryPage`, with an env var to fill in.
 */
export function registryServer(overrides: Partial<RegistryServer> = {}): RegistryServer {
  return registryServerSchema.parse({
    name: 'io.github.example/weather',
    title: 'Weather',
    description: 'Forecasts for any city.',
    version: '1.2.0',
    repository: { url: 'https://github.com/example/weather', source: 'github' },
    packages: [
      {
        registryType: 'npm',
        identifier: '@example/weather-mcp',
        version: '1.2.0',
        transport: { type: 'stdio' },
        environmentVariables: [
          { name: 'WEATHER_API_KEY', description: 'Key for the forecast API.', isRequired: true, isSecret: true },
        ],
      },
    ],
    ...overrides,
  });
}

/**
 * Builds a skills server found on the local network, which asks for a token.
 *
 * @param [overrides] - Any part of it to replace.
 * @returns The found server, not yet added.
 */
export function discoveredServer(overrides: Partial<LanServer> = {}): LanServer {
  return {
    key: 'MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills',
    cardName: 'io.github.cubicecho.mcp-skills.nas/skills',
    title: 'MCP Skills on nas',
    description: 'Skills for agents, served over MCP.',
    version: '4.1.0',
    host: 'MCP Skills on nas',
    url: 'http://192.168.1.20:3000/mcp',
    requiredHeaders: ['Authorization'],
    suggestedName: 'skills',
    state: LanServerState.Available,
    serverName: null,
    ...overrides,
  };
}

/**
 * Builds what `lanServers` answers.
 *
 * @param [overrides] - Any part of the answer to replace.
 * @returns Discovery on, with one found server waiting to be added.
 */
export function discovery(overrides: Partial<LanDiscovery> = {}): LanDiscovery {
  return { enabled: true, servers: [discoveredServer()], ...overrides };
}

/**
 * Builds the answer to the found-servers query.
 *
 * @param [overrides] - Any part of the discovery to replace.
 * @returns The `LanServers` data.
 */
export function lanServersAnswer(overrides: Partial<LanDiscovery> = {}): LanServersQuery {
  return { lanServers: discovery(overrides) };
}
