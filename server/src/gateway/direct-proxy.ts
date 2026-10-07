import { CallVia } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SERVER_VERSION } from '../version.ts';
import { emptyOnMissing, proxyCapabilities } from './capability.ts';
import type { Handshake } from './handshake.ts';
import { McpMethod } from './mcp-method.ts';
import { EMPTY_COMPLETION, type ProxyDeps, track } from './track.ts';

/**
 * MCP server proxying a single downstream server 1:1 (used for /mcp/:name).
 *
 * @param downstream What the server said at its last connect. Its instructions are
 *   forwarded unchanged, since nothing is renamed on this endpoint.
 */
export function createProxyServer(name: string, deps: ProxyDeps, downstream: Handshake = {}): Server {
  const advertised = proxyCapabilities(downstream.capabilities);
  const server = new Server(
    { name: `mcp-router/${name}`, version: SERVER_VERSION },
    { capabilities: advertised, instructions: downstream.instructions },
  );
  const withClient = <R>(run: (client: Client) => Promise<R>) => deps.withClient(name, run);

  /** A call that names what it acts on: always recorded, under that target. */
  const targetedCall = <R>(method: string, target: string, params: unknown, run: (client: Client) => Promise<R>) =>
    track(deps, name, { via: CallVia.Direct, method, target, params }, () => withClient(run));

  /**
   * A routine read: only its failures are recorded, and a downstream that lacks the capability
   * answers `empty` instead of failing.
   */
  const quietRead = <R, E>(method: string, params: unknown, empty: E, run: (client: Client) => Promise<R>) =>
    track(
      deps,
      name,
      { via: CallVia.Direct, method, params, failuresOnly: true },
      async () => (await emptyOnMissing(() => withClient(run))) ?? empty,
    );

  // A handler only per declared surface: the SDK refuses any other, and "no such
  // method" is truer for a tools-only server than an empty resource list.
  if (advertised.tools) {
    server.setRequestHandler(ListToolsRequestSchema, async (req) =>
      track(
        deps,
        name,
        { via: CallVia.Direct, method: McpMethod.ToolsList, params: req.params, failuresOnly: true },
        async () => {
          // A missing capability means "no tools", so the old count is cleared;
          // any other failure propagates to track().
          const result = await emptyOnMissing(() => withClient((c) => c.listTools(req.params)));
          deps.recordToolCount(name, result?.tools.length ?? 0);
          return result ?? { tools: [] };
        },
      ),
    );

    server.setRequestHandler(CallToolRequestSchema, async (req) =>
      targetedCall(
        McpMethod.ToolsCall,
        req.params.name,
        req.params,
        async (c) => (await c.callTool(req.params)) as CallToolResult,
      ),
    );
  }

  if (advertised.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, async (req) =>
      quietRead(McpMethod.ResourcesList, req.params, { resources: [] }, (c) => c.listResources(req.params)),
    );

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) =>
      quietRead(McpMethod.ResourceTemplatesList, req.params, { resourceTemplates: [] }, (c) =>
        c.listResourceTemplates(req.params),
      ),
    );

    server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
      targetedCall(McpMethod.ResourcesRead, req.params.uri, req.params, (c) => c.readResource(req.params)),
    );
  }

  // Only where the downstream said it can: a subscribe to a server that cannot
  // is a request that exists to fail.
  if (advertised.resources?.subscribe) {
    server.setRequestHandler(SubscribeRequestSchema, async (req) =>
      targetedCall(McpMethod.ResourcesSubscribe, req.params.uri, req.params, (c) => c.subscribeResource(req.params)),
    );

    server.setRequestHandler(UnsubscribeRequestSchema, async (req) =>
      targetedCall(McpMethod.ResourcesUnsubscribe, req.params.uri, req.params, (c) =>
        c.unsubscribeResource(req.params),
      ),
    );
  }

  if (advertised.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async (req) =>
      quietRead(McpMethod.PromptsList, req.params, { prompts: [] }, (c) => c.listPrompts(req.params)),
    );

    server.setRequestHandler(GetPromptRequestSchema, async (req) =>
      targetedCall(McpMethod.PromptsGet, req.params.name, req.params, (c) => c.getPrompt(req.params)),
    );
  }

  if (advertised.completions) {
    // Completions fire per keystroke; like list ops, only their failures are recorded.
    server.setRequestHandler(CompleteRequestSchema, async (req) =>
      quietRead(McpMethod.CompletionComplete, req.params, EMPTY_COMPLETION, (c) => c.complete(req.params)),
    );
  }

  if (advertised.logging) {
    server.setRequestHandler(SetLevelRequestSchema, async (req) =>
      track(
        deps,
        name,
        { via: CallVia.Direct, method: McpMethod.LoggingSetLevel, target: req.params.level, params: req.params },
        async () => {
          await emptyOnMissing(() => withClient((c) => c.setLoggingLevel(req.params.level)));
          return {};
        },
      ),
    );
  }

  return server;
}
