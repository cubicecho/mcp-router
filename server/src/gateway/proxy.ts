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
import { errorMessage } from '../errors.ts';
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
  return new McpError(ErrorCode.InternalError, errorMessage(err));
}

export interface ProxyDeps {
  getClient: (name: string) => Promise<Client>;
  recordToolCount: (name: string, count: number) => void;
  recordActivity: (name: string, entry: Omit<ActivityEntry, 'id'>) => void;
}

/**
 * Run a downstream call, recording its params + result/error and timing to the
 * server's activity log. Records both outcomes; always re-raises on failure.
 */
async function track<T>(
  deps: ProxyDeps,
  name: string,
  via: ActivityEntry['via'],
  method: string,
  target: string | undefined,
  params: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via,
      method,
      target,
      ok: true,
      durationMs: Date.now() - startedAt,
      params,
      result,
    });
    return result;
  } catch (err) {
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via,
      method,
      target,
      ok: false,
      durationMs: Date.now() - startedAt,
      params,
      error: errorMessage(err),
    });
    throw err;
  }
}

/** MCP server proxying a single downstream server 1:1 (used for /mcp/:name). */
export function createProxyServer(name: string, deps: ProxyDeps): Server {
  const server = new Server({ name: `mcp-router/${name}`, version: SERVER_VERSION }, PROXY_CAPABILITIES);
  const client = () => deps.getClient(name);

  server.setRequestHandler(ListToolsRequestSchema, async (req) =>
    track(deps, name, 'direct', 'tools/list', undefined, req.params, async () => {
      try {
        const result = await (await client()).listTools(req.params);
        deps.recordToolCount(name, result.tools.length);
        return result;
      } catch (err) {
        if (lacksCapability(err)) {
          return { tools: [] };
        }
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    track(deps, name, 'direct', 'tools/call', req.params.name, req.params, async () => {
      try {
        return (await (await client()).callTool(req.params)) as CallToolResult;
      } catch (err) {
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (req) =>
    track(deps, name, 'direct', 'resources/list', undefined, req.params, async () => {
      try {
        return await (await client()).listResources(req.params);
      } catch (err) {
        if (lacksCapability(err)) {
          return { resources: [] };
        }
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) =>
    track(deps, name, 'direct', 'resources/templates/list', undefined, req.params, async () => {
      try {
        return await (await client()).listResourceTemplates(req.params);
      } catch (err) {
        if (lacksCapability(err)) {
          return { resourceTemplates: [] };
        }
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    track(deps, name, 'direct', 'resources/read', req.params.uri, req.params, async () => {
      try {
        return await (await client()).readResource(req.params);
      } catch (err) {
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async (req) =>
    track(deps, name, 'direct', 'prompts/list', undefined, req.params, async () => {
      try {
        return await (await client()).listPrompts(req.params);
      } catch (err) {
        if (lacksCapability(err)) {
          return { prompts: [] };
        }
        throw toMcpError(err);
      }
    }),
  );

  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    track(deps, name, 'direct', 'prompts/get', req.params.name, req.params, async () => {
      try {
        return await (await client()).getPrompt(req.params);
      } catch (err) {
        throw toMcpError(err);
      }
    }),
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

  const collect = async <T>(fn: (client: Client, name: string) => Promise<T[]>): Promise<T[]> => {
    const names = deps.serverNames();
    const results = await Promise.all(
      names.map(async (name) => {
        try {
          return await fn(await deps.getClient(name), name);
        } catch (err) {
          if (!lacksCapability(err)) {
            console.warn(`Skipping server "${name}" in aggregate: ${errorMessage(err)}`);
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
    const tools = await collect(async (client, name) => {
      const result = await client.listTools();
      deps.recordToolCount(name, result.tools.length);
      return result.tools.map((tool) => ({ ...tool, name: namespaceName(name, tool.name) }));
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { serverName, name } = route(req.params.name, 'tool');
    const params = { ...req.params, name };
    return track(deps, serverName, 'aggregate', 'tools/call', name, params, async () => {
      try {
        const client = await deps.getClient(serverName);
        return (await client.callTool(params)) as CallToolResult;
      } catch (err) {
        throw toMcpError(err);
      }
    });
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await collect(async (client, name) => {
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
    return track(deps, serverName, 'aggregate', 'resources/read', uri, params, async () => {
      try {
        const client = await deps.getClient(serverName);
        return await client.readResource(params);
      } catch (err) {
        throw toMcpError(err);
      }
    });
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts = await collect(async (client, name) => {
      const result = await client.listPrompts();
      return result.prompts.map((prompt) => ({ ...prompt, name: namespaceName(name, prompt.name) }));
    });
    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { serverName, name } = route(req.params.name, 'prompt');
    const params = { ...req.params, name };
    return track(deps, serverName, 'aggregate', 'prompts/get', name, params, async () => {
      try {
        const client = await deps.getClient(serverName);
        return await client.getPrompt(params);
      } catch (err) {
        throw toMcpError(err);
      }
    });
  });

  return server;
}
