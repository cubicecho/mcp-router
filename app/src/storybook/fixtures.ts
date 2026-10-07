import {
  type ActivityEntry,
  activityEntrySchema,
  type PromptGetResponse,
  promptGetResponseSchema,
  type Registry,
  type RegistryListResponse,
  type RegistryServer,
  type ReloadResponse,
  type ResourceReadResponse,
  type RouterStatus,
  registryListResponseSchema,
  registrySchema,
  registryServerSchema,
  reloadResponseSchema,
  resourceReadResponseSchema,
  routerStatusSchema,
  type ServerPromptsResponse,
  type ServerResourcesResponse,
  type ServerStatus,
  type ServerToolsResponse,
  serverPromptsResponseSchema,
  serverResourcesResponseSchema,
  serverStatusSchema,
  serverToolsResponseSchema,
  type ToolCallResponse,
  toolCallResponseSchema,
  type UpdateSettingsResponse,
  updateSettingsResponseSchema,
  type WorkspaceStatus,
  workspaceStatusSchema,
} from '@mcp-router/shared';
import type { ApiRoutes } from './mock-api.ts';

// Every fixture is read through the shared schema for its shape, so a story's server
// cannot answer with something the real one would not.

/**
 * Builds a running stdio server installed from npm.
 *
 * @param [overrides] - Any part of the status to replace; `name` sets the config's name.
 * @returns The status, parsed through the shared schema.
 */
export function stdioServer(overrides: Partial<ServerStatus> & { name?: string } = {}): ServerStatus {
  const { name = 'filesystem', ...status } = overrides;
  return serverStatusSchema.parse({
    config: {
      name,
      displayName: 'Filesystem',
      description: 'Read and write files under one folder.',
      enabled: true,
      source: { type: 'npm', package: '@modelcontextprotocol/server-filesystem' },
      transport: { type: 'stdio', command: 'node', args: ['index.js', '/tmp'] },
      env: { ROOT_DIR: '/tmp' },
      envMeta: { ROOT_DIR: { description: 'The folder the server may touch.', isRequired: true } },
    },
    state: 'running',
    toolCount: 3,
    callCount: 12,
    lastCalledAt: '2026-10-01T12:00:00.000Z',
    ...status,
  });
}

/**
 * Builds a stopped remote server reached over streamable HTTP.
 *
 * @param [overrides] - Any part of the status to replace; `name` sets the config's name.
 * @returns The status, parsed through the shared schema.
 */
export function remoteServer(overrides: Partial<ServerStatus> & { name?: string } = {}): ServerStatus {
  const { name = 'docs', ...status } = overrides;
  return serverStatusSchema.parse({
    config: {
      name,
      enabled: true,
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'https://docs.example.test/mcp', headers: {} },
      env: {},
      envMeta: {},
    },
    state: 'stopped',
    ...status,
  });
}

/**
 * Builds the router's own status, with auth off.
 *
 * @param [overrides] - Any part of the status to replace; the result must still pass the shared schema.
 * @returns The status of a router with two servers, one running.
 */
export function routerStatus(overrides: Partial<RouterStatus> = {}): RouterStatus {
  return routerStatusSchema.parse({
    version: '2.7.1',
    uptimeSeconds: 3600,
    serverCount: 2,
    runningCount: 1,
    authEnabled: false,
    idleTimeoutMs: 300_000,
    ...overrides,
  });
}

/**
 * Builds a workspace of the two fixture servers, the second switched off.
 *
 * @param [overrides] - Any part of the workspace to replace; the result must still pass the shared schema.
 * @returns The `research` workspace.
 */
export function workspace(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return workspaceStatusSchema.parse({
    name: 'Research',
    slug: 'research',
    enabled: true,
    description: 'Files and docs for the research agent.',
    members: { filesystem: { enabled: true, env: { ROOT_DIR: '/srv/research' } }, docs: { enabled: false } },
    path: '/mcp/w/research',
    ...overrides,
  });
}

/**
 * Builds the official registry.
 *
 * @param [overrides] - Any part of the registry to replace; the result must still pass the shared schema.
 * @returns The registry.
 */
export function registry(overrides: Partial<Registry> = {}): Registry {
  return registrySchema.parse({
    name: 'official',
    url: 'https://registry.modelcontextprotocol.io',
    ...overrides,
  });
}

/**
 * Builds one page of a registry search.
 *
 * @returns Two entries, an npm package with an env var to fill in and a remote, and no next cursor.
 */
export function registryPage(): RegistryListResponse {
  return registryListResponseSchema.parse({
    servers: [
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
    ],
    metadata: { count: 2 },
  });
}

/**
 * Builds one recorded call.
 *
 * @param [overrides] - Any part of the entry to replace; the result must still pass the shared schema.
 * @returns A successful direct `tools/call` of `read_file`.
 */
export function activityEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return activityEntrySchema.parse({
    id: 1,
    at: '2026-10-01T12:00:00.000Z',
    via: 'direct',
    method: 'tools/call',
    target: 'read_file',
    ok: true,
    durationMs: 42,
    params: { name: 'read_file', arguments: { path: '/tmp/notes.txt' } },
    result: { content: [{ type: 'text', text: 'hello' }] },
    ...overrides,
  });
}

/** The tools, resources and prompts a fixture server lists. */
export const capabilities = {
  tools: {
    tools: [
      {
        name: 'read_file',
        description: 'Read one file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'The file to read.' } },
          required: ['path'],
        },
      },
      { name: 'list_files', description: 'List a folder.', inputSchema: { type: 'object', properties: {} } },
    ],
  },
  resources: {
    resources: [{ uri: 'file:///tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain' }],
    resourceTemplates: [],
  },
  prompts: {
    prompts: [
      {
        name: 'summarise',
        description: 'Summarise a file.',
        arguments: [{ name: 'path', description: 'The file to summarise.', required: true }],
      },
    ],
  },
};

/**
 * Builds the routes of a router with the two fixture servers, one workspace and one registry.
 *
 * @returns A fresh route map, enough for any page to load.
 *
 * @remarks
 * Spread it into a story's `parameters.api` and override what the story is about.
 */
export function appRoutes(): ApiRoutes {
  const servers = [stdioServer(), remoteServer()];
  const routes: ApiRoutes = {
    'GET /api/status': routerStatus(),
    'GET /api/servers': servers,
    'GET /api/workspaces': [workspace()],
    'GET /api/workspaces/research': workspace(),
    'GET /api/registries': [registry()],
    'GET /api/registries/official/servers': registryPage(),
  };
  for (const server of servers) {
    routes[`GET /api/servers/${server.config.name}`] = server;
  }
  for (const base of ['/api/servers/filesystem', '/api/servers/docs', '/api/workspaces/research']) {
    routes[`GET ${base}/tools`] = capabilities.tools;
    routes[`GET ${base}/resources`] = capabilities.resources;
    routes[`GET ${base}/prompts`] = capabilities.prompts;
    routes[`GET ${base}/activity`] = { entries: [activityEntry()] };
  }
  return routes;
}

/**
 * Builds the answer to a tools listing.
 *
 * @param [overrides] - Any part of the listing to replace; the result must still pass the shared schema.
 * @returns `read_file`, which takes a path, and `list_files`, which takes nothing.
 */
export function toolsResponse(overrides: Partial<ServerToolsResponse> = {}): ServerToolsResponse {
  return serverToolsResponseSchema.parse({ ...capabilities.tools, ...overrides });
}

/**
 * Builds the answer to a resources listing.
 *
 * @param [overrides] - Any part of the listing to replace; the result must still pass the shared schema.
 * @returns One text file and one template with a placeholder to fill in.
 */
export function resourcesResponse(overrides: Partial<ServerResourcesResponse> = {}): ServerResourcesResponse {
  return serverResourcesResponseSchema.parse({
    ...capabilities.resources,
    resourceTemplates: [{ uriTemplate: 'file:///tmp/{name}', name: 'any file', description: 'Any file under /tmp.' }],
    ...overrides,
  });
}

/**
 * Builds the answer to a prompts listing.
 *
 * @param [overrides] - Any part of the listing to replace; the result must still pass the shared schema.
 * @returns `summarise`, which requires a path.
 */
export function promptsResponse(overrides: Partial<ServerPromptsResponse> = {}): ServerPromptsResponse {
  return serverPromptsResponseSchema.parse({ ...capabilities.prompts, ...overrides });
}

/**
 * Builds what a tool call returned.
 *
 * @param [overrides] - Any part of the result to replace; pass `isError` for a tool that reported a failure.
 * @returns One line of text.
 */
export function toolCallResult(overrides: Partial<ToolCallResponse> = {}): ToolCallResponse {
  return toolCallResponseSchema.parse({ content: [{ type: 'text', text: 'hello from notes.txt' }], ...overrides });
}

/**
 * Builds what reading a resource returned.
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
 * Builds what getting a prompt returned.
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
 * Builds what `PATCH /api/settings` answers once the idle timeout is saved.
 *
 * @param [overrides] - Any part of the answer to replace; the result must still pass the shared schema.
 * @returns The saved settings.
 */
export function settingsResult(overrides: Partial<UpdateSettingsResponse> = {}): UpdateSettingsResponse {
  return updateSettingsResponseSchema.parse({ idleTimeoutMs: 300_000, ...overrides });
}

/**
 * Builds what `POST /api/reload` answers.
 *
 * @param [overrides] - Any part of the answer to replace; the result must still pass the shared schema.
 * @returns A successful reload that left the two fixture servers.
 */
export function reloadResult(overrides: Partial<ReloadResponse> = {}): ReloadResponse {
  return reloadResponseSchema.parse({ reloaded: true, serverCount: 2, ...overrides });
}

/**
 * Builds a registry search that matched nothing.
 *
 * @returns A page with no entries and no next cursor.
 */
export function emptyRegistryPage(): RegistryListResponse {
  return registryListResponseSchema.parse({ servers: [], metadata: { count: 0 } });
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
