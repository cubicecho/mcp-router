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
import { SERVER_VERSION } from '../core/version.ts';
import { emptyOnMissing, proxyCapabilities } from './capability.ts';
import type { Handshake } from './handshake.ts';
import { McpMethod } from './mcp-method.ts';
import { EMPTY_COMPLETION, type ProxyDeps, track } from './track.ts';

/**
 * Builds the MCP server that proxies a single downstream server 1:1 (used for /mcp/:name).
 *
 * @param name - The downstream server; every call is made and recorded under it.
 * @param deps - Reaches the server and records its calls.
 * @param [downstream] - What the server said at its last connect; its instructions are forwarded unchanged.
 * @returns The server, not yet connected to a transport, with a handler only for each surface it advertises.
 */
export function createProxyServer(name: string, deps: ProxyDeps, downstream: Handshake = {}): Server {
  const advertised = proxyCapabilities(downstream.capabilities);
  const server = new Server(
    { name: `mcp-router/${name}`, version: SERVER_VERSION },
    { capabilities: advertised, instructions: downstream.instructions },
  );
  const withClient = <R>(run: (client: Client) => Promise<R>) => deps.withClient(name, run);

  /**
   * Makes a call that names what it acts on: always recorded, under that target.
   *
   * @param method - The MCP method, as recorded.
   * @param target - The tool name, prompt name or resource URI.
   * @param params - The request params, as recorded.
   * @param run - The call against the downstream client.
   * @returns What `run` resolved to; a failure is thrown as an McpError.
   */
  const targetedCall = <R>(method: string, target: string, params: unknown, run: (client: Client) => Promise<R>) =>
    track(deps, name, { via: CallVia.Direct, method, target, params }, () => withClient(run));

  /**
   * Makes a routine read, of which only the failures are recorded.
   *
   * @param method - The MCP method, as recorded.
   * @param params - The request params, as recorded.
   * @param empty - Answered in place of a failure when the downstream lacks the capability.
   * @param run - The read against the downstream client.
   * @returns What `run` resolved to, or `empty`.
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
