import { listAllTools } from '@cubicecho/agent-mcp-pool';
import { CallVia } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SERVER_VERSION } from '../core/version.ts';
import { emptyOnMissing, PROXY_CAPABILITIES } from './capability.ts';
import { collectFrom } from './fan-out.ts';
import { McpMethod } from './mcp-method.ts';
import { namespaceName, splitNamespacedName } from './naming.ts';
import { listAllPrompts, listAllResources, listAllResourceTemplates } from './pagination.ts';
import { EMPTY_COMPLETION, type ProxyDeps, track } from './track.ts';

export interface AggregateDeps extends ProxyDeps {
  /** Names of all enabled servers at request time. */
  serverNames: () => string[];
}

/**
 * MCP server merging all enabled downstream servers (used for /mcp).
 * Tool/prompt names and resource URIs are prefixed `<server>__`; calls strip
 * the prefix and route to the owning client. Downstream servers that fail to
 * connect (or lack a capability) are skipped, not fatal.
 *
 * @param instructions The merged member instructions — see `mergeInstructions`.
 *   Fixed for the life of the session, because `instructions` travels only in
 *   the initialize result.
 */
export function createAggregateServer(deps: AggregateDeps, instructions?: string): Server {
  const server = new Server(
    { name: 'mcp-router', version: SERVER_VERSION },
    // The union: an aggregate never connects its members while a client is
    // initializing, so what any of them might support is the honest answer.
    { capabilities: PROXY_CAPABILITIES, instructions },
  );

  // Aggregate list ops fan out to every enabled server on each client
  // (re)connect and list_changed; see collectFrom for what that does and does
  // not record.
  const collect = <T>(method: string, fn: (client: Client, name: string) => Promise<T[]>): Promise<T[]> =>
    collectFrom(deps.serverNames(), method, deps, fn);

  const route = (full: string, kind: string) => {
    const split = splitNamespacedName(full, deps.serverNames());
    if (!split) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown ${kind} "${full}" (expected <server>__<name>)`);
    }
    return split;
  };

  /**
   * Route a namespaced name to its owning server and run the call there with the prefix stripped.
   *
   * Routing runs before track(): a name that resolves to no known server is a caller argument
   * error with no server to attribute it to (the same shape as hitting /mcp/<unknown>, which also
   * 404s unrecorded). Once resolved, every outcome — including downstream failures — is recorded
   * under that server.
   *
   * @param strip - Rebuilds the request params around the un-prefixed name.
   */
  const routedCall = <P, R>(
    method: string,
    kind: string,
    full: string,
    strip: (name: string) => P,
    run: (client: Client, params: P) => Promise<R>,
  ): Promise<R> => {
    const { serverName, name } = route(full, kind);
    const params = strip(name);
    return track(deps, serverName, { via: CallVia.Aggregate, method, target: name, params }, () =>
      deps.withClient(serverName, (client) => run(client, params)),
    );
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await collect(McpMethod.ToolsList, async (client, name) => {
      // A missing capability is a definitive "has no tools" — clear any count
      // from a previous incarnation; any other failure lets collect() skip the
      // server and record why.
      const all = await emptyOnMissing(() => listAllTools(client));
      deps.recordToolCount(name, all?.length ?? 0);
      return (all ?? []).map((tool) => ({ ...tool, name: namespaceName(name, tool.name) }));
    });
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    routedCall(
      McpMethod.ToolsCall,
      'tool',
      req.params.name,
      (name) => ({ ...req.params, name }),
      (client, params) => client.callTool(params),
    ),
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = await collect(McpMethod.ResourcesList, async (client, name) => {
      const all = await listAllResources(client);
      return all.map((resource) => ({
        ...resource,
        uri: namespaceName(name, resource.uri),
        name: namespaceName(name, resource.name),
      }));
    });
    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const resourceTemplates = await collect(McpMethod.ResourceTemplatesList, async (client, name) => {
      const all = await listAllResourceTemplates(client);
      // Namespace the URI template so a read of an expanded URI routes back to
      // this server, mirroring how plain resources namespace their `uri`.
      return all.map((template) => ({
        ...template,
        uriTemplate: namespaceName(name, template.uriTemplate),
        name: namespaceName(name, template.name),
      }));
    });
    return { resourceTemplates };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) =>
    routedCall(
      McpMethod.ResourcesRead,
      'resource',
      req.params.uri,
      (uri) => ({ ...req.params, uri }),
      (client, params) => client.readResource(params),
    ),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts = await collect(McpMethod.PromptsList, async (client, name) => {
      const all = await listAllPrompts(client);
      return all.map((prompt) => ({ ...prompt, name: namespaceName(name, prompt.name) }));
    });
    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    routedCall(
      McpMethod.PromptsGet,
      'prompt',
      req.params.name,
      (name) => ({ ...req.params, name }),
      (client, params) => client.getPrompt(params),
    ),
  );

  // The completion ref is namespaced like the prompt/resource it points at
  // (`<server>__<name>` for prompts, `<server>__<uri>` for resources); strip it
  // to route, then hand the downstream its own un-prefixed ref.
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const ref = req.params.ref;
    const full = ref.type === 'ref/prompt' ? ref.name : ref.uri;
    const { serverName, name } = route(full, 'completion ref');
    const strippedRef = ref.type === 'ref/prompt' ? { ...ref, name } : { ...ref, uri: name };
    const params = { ...req.params, ref: strippedRef };
    return track(
      deps,
      serverName,
      { via: CallVia.Aggregate, method: McpMethod.CompletionComplete, target: full, params, failuresOnly: true },
      async () => {
        return (
          (await emptyOnMissing(() => deps.withClient(serverName, (client) => client.complete(params)))) ??
          EMPTY_COMPLETION
        );
      },
    );
  });

  server.setRequestHandler(SubscribeRequestSchema, async (req) =>
    routedCall(
      McpMethod.ResourcesSubscribe,
      'resource',
      req.params.uri,
      (uri) => ({ ...req.params, uri }),
      (client, params) => client.subscribeResource(params),
    ),
  );

  server.setRequestHandler(UnsubscribeRequestSchema, async (req) =>
    routedCall(
      McpMethod.ResourcesUnsubscribe,
      'resource',
      req.params.uri,
      (uri) => ({ ...req.params, uri }),
      (client, params) => client.unsubscribeResource(params),
    ),
  );

  // setLevel has no ref, so it applies to the whole connection: fan the level
  // out to every member (best-effort — capability-less members are skipped).
  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    await collect(McpMethod.LoggingSetLevel, async (client) => {
      await client.setLoggingLevel(req.params.level);
      return [];
    });
    return {};
  });

  return server;
}
