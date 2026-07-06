import type { ActivityEntry } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { errorDetailMessage, errorMessage } from '../errors.ts';
import { SERVER_VERSION } from '../version.ts';
import { namespaceName, splitNamespacedName } from './naming.ts';

const PROXY_CAPABILITIES = { capabilities: { tools: {}, resources: {}, prompts: {} } };

/**
 * The downstream lacks the capability entirely: either it answered
 * "method not found" or our client-side capability assertion refused to send.
 * List endpoints treat this as an empty list.
 */
function lacksCapability(err: unknown): boolean {
  if (err instanceof McpError && err.code === ErrorCode.MethodNotFound) {
    return true;
  }
  return err instanceof Error && /does not support/i.test(err.message);
}

/** Propagate a downstream failure as a proper MCP error. */
function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) {
    return err;
  }
  return new McpError(ErrorCode.InternalError, errorDetailMessage(err));
}

/** A tool call that resolves with `isError: true` is a downstream failure, not a success. */
function toolCallFailed(result: unknown): boolean {
  return Boolean((result as CallToolResult | undefined)?.isError);
}

/** Best-effort error message for a tool call that resolved with `isError: true`. */
function toolErrorText(result: unknown): string {
  const content = (result as CallToolResult).content;
  const text = Array.isArray(content)
    ? content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    : '';
  return text || 'Tool reported an error (isError: true)';
}

export interface ProxyDeps {
  getClient: (name: string) => Promise<Client>;
  recordToolCount: (name: string, count: number) => void;
  recordActivity: (name: string, entry: Omit<ActivityEntry, 'id'>) => void;
}

interface TrackContext {
  via: ActivityEntry['via'];
  method: string;
  target?: string;
  params?: unknown;
  /**
   * Skip recording successes. List ops arrive on every client (re)connect and
   * list_changed, so recording their routine successes would flood the bounded
   * per-server log and evict the targeted tool/resource/prompt calls the
   * Activity tab exists to show. Failures always record.
   */
  failuresOnly?: boolean;
}

/**
 * Run a downstream call, recording its params + result/error and timing to the
 * server's activity log. Records both outcomes, converts a raw downstream
 * failure into a proper MCP error, and always re-raises.
 */
async function track<T>(deps: ProxyDeps, name: string, ctx: TrackContext, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    // tools/call resolves (does not throw) for tool-level errors, flagging them
    // via `isError` on the result — so success/failure can't be inferred from
    // throw-vs-return alone. Derived here, once, so no call site can forget it.
    const failed = ctx.method === 'tools/call' && toolCallFailed(result);
    if (ctx.failuresOnly && !failed) {
      return result;
    }
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via: ctx.via,
      method: ctx.method,
      target: ctx.target,
      ok: !failed,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      result,
      error: failed ? toolErrorText(result) : undefined,
    });
    return result;
  } catch (err) {
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via: ctx.via,
      method: ctx.method,
      target: ctx.target,
      ok: false,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      error: errorDetailMessage(err),
    });
    throw toMcpError(err);
  }
}

/** MCP server proxying a single downstream server 1:1 (used for /mcp/:name). */
export function createProxyServer(name: string, deps: ProxyDeps): Server {
  const server = new Server({ name: `mcp-router/${name}`, version: SERVER_VERSION }, PROXY_CAPABILITIES);
  const client = () => deps.getClient(name);

  server.setRequestHandler(ListToolsRequestSchema, async (req) =>
    track(deps, name, { via: 'direct', method: 'tools/list', params: req.params, failuresOnly: true }, async () => {
      try {
        const result = await (await client()).listTools(req.params);
        deps.recordToolCount(name, result.tools.length);
        return result;
      } catch (err) {
        if (lacksCapability(err)) {
          return { tools: [] };
        }
        throw err; // track() converts to an MCP error
      }
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    track(
      deps,
      name,
      { via: 'direct', method: 'tools/call', target: req.params.name, params: req.params },
      async () => (await (await client()).callTool(req.params)) as CallToolResult,
    ),
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (req) =>
    track(deps, name, { via: 'direct', method: 'resources/list', params: req.params, failuresOnly: true }, async () => {
      try {
        return await (await client()).listResources(req.params);
      } catch (err) {
        if (lacksCapability(err)) {
          return { resources: [] };
        }
        throw err;
      }
    }),
  );

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) =>
    track(
      deps,
      name,
      { via: 'direct', method: 'resources/templates/list', params: req.params, failuresOnly: true },
      async () => {
        try {
          return await (await client()).listResourceTemplates(req.params);
        } catch (err) {
          if (lacksCapability(err)) {
            return { resourceTemplates: [] };
          }
          throw err;
        }
      },
    ),
  );

  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    track(deps, name, { via: 'direct', method: 'resources/read', target: req.params.uri, params: req.params }, () =>
      client().then((c) => c.readResource(req.params)),
    ),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async (req) =>
    track(deps, name, { via: 'direct', method: 'prompts/list', params: req.params, failuresOnly: true }, async () => {
      try {
        return await (await client()).listPrompts(req.params);
      } catch (err) {
        if (lacksCapability(err)) {
          return { prompts: [] };
        }
        throw err;
      }
    }),
  );

  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    track(deps, name, { via: 'direct', method: 'prompts/get', target: req.params.name, params: req.params }, () =>
      client().then((c) => c.getPrompt(req.params)),
    ),
  );

  return server;
}

export interface AggregateDeps extends ProxyDeps {
  /** Names of all enabled servers at request time. */
  serverNames: () => string[];
}

/**
 * MCP server merging all enabled downstream servers (used for /mcp).
 * Tool/prompt names and resource URIs are prefixed `<server>__`; calls strip
 * the prefix and route to the owning client. Downstream servers that fail to
 * connect (or lack a capability) are skipped, not fatal.
 */
export function createAggregateServer(deps: AggregateDeps): Server {
  const server = new Server({ name: 'mcp-router', version: SERVER_VERSION }, PROXY_CAPABILITIES);

  // Aggregate list ops fan out to every server on each client (re)connect and
  // list_changed; like the direct list handlers, routine successes are NOT
  // recorded to activity (they would flood each server's bounded log and evict
  // the targeted calls the Activity tab exists to show), but a server that
  // errors during the fan-out is — that failure is exactly the "why doesn't my
  // server show up in /mcp" case the tab is for. Capability-less servers are
  // skipped silently, as on the direct path.
  const collect = async <T>(method: string, fn: (client: Client, name: string) => Promise<T[]>): Promise<T[]> => {
    const names = deps.serverNames();
    const results = await Promise.all(
      names.map(async (name) => {
        const startedAt = Date.now();
        try {
          return await fn(await deps.getClient(name), name);
        } catch (err) {
          if (!lacksCapability(err)) {
            console.warn(`Skipping server "${name}" in aggregate: ${errorMessage(err)}`);
            deps.recordActivity(name, {
              at: new Date().toISOString(),
              via: 'aggregate',
              method,
              ok: false,
              durationMs: Date.now() - startedAt,
              error: errorDetailMessage(err),
            });
          }
          return [];
        }
      }),
    );
    return results.flat();
  };

  const route = (full: string, kind: string) => {
    const split = splitNamespacedName(full, deps.serverNames());
    if (!split) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown ${kind} "${full}" (expected <server>__<name>)`);
    }
    return split;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await collect('tools/list', async (client, name) => {
      const result = await client.listTools();
      deps.recordToolCount(name, result.tools.length);
      return result.tools.map((tool) => ({ ...tool, name: namespaceName(name, tool.name) }));
    });
    return { tools };
  });

  // Routing runs before track(): a name that resolves to no known server is a
  // caller argument error with no server to attribute it to (the same shape as
  // hitting /mcp/<unknown>, which also 404s unrecorded). Once resolved, every
  // outcome — including downstream failures — is recorded under that server.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { serverName, name } = route(req.params.name, 'tool');
    const params = { ...req.params, name };
    return track(
      deps,
      serverName,
      { via: 'aggregate', method: 'tools/call', target: name, params },
      async () => (await (await deps.getClient(serverName)).callTool(params)) as CallToolResult,
    );
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await collect('resources/list', async (client, name) => {
      const result = await client.listResources();
      return result.resources.map((resource) => ({
        ...resource,
        uri: namespaceName(name, resource.uri),
        name: namespaceName(name, resource.name),
      }));
    });
    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return { resourceTemplates: [] };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { serverName, name: uri } = route(req.params.uri, 'resource');
    const params = { ...req.params, uri };
    return track(deps, serverName, { via: 'aggregate', method: 'resources/read', target: uri, params }, () =>
      deps.getClient(serverName).then((client) => client.readResource(params)),
    );
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts = await collect('prompts/list', async (client, name) => {
      const result = await client.listPrompts();
      return result.prompts.map((prompt) => ({ ...prompt, name: namespaceName(name, prompt.name) }));
    });
    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { serverName, name } = route(req.params.name, 'prompt');
    const params = { ...req.params, name };
    return track(deps, serverName, { via: 'aggregate', method: 'prompts/get', target: name, params }, () =>
      deps.getClient(serverName).then((client) => client.getPrompt(params)),
    );
  });

  return server;
}
