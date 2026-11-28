import { promptGetRequestSchema, resourceReadRequestSchema, toolCallRequestSchema } from '@mcp-router/shared';
import { GraphQLJSON } from '@vantreeseba/drizzle-graphql';
import { type GraphQLFieldConfigArgumentMap, type GraphQLFieldConfigMap, GraphQLNonNull, GraphQLString } from 'graphql';
import type { Context } from '../../core/context.ts';
import { parseOrThrow } from '../../core/validation.ts';
import {
  callUiTool,
  getUiPrompt,
  type LocateUiCall,
  locateInWorkspace,
  locateOnServer,
  readUiResource,
} from '../../gateway/ui-calls.ts';
import { handField } from '../hand-field.ts';
import { requireServerName, requireWorkspace } from '../lookups.ts';
import { McpPromptMessagesType, McpResourceContentsType, McpToolResultType } from '../types.ts';

// The try-it calls: run one tool, read one resource or render one prompt, against a server or a workspace, as the UI's
// capability panels do. Each one is recorded to the activity log under via UI.

/** Arguments of a tool call. */
interface ToolArgs {
  tool: string;
  arguments?: unknown;
}

/** Arguments of a resource read. */
interface ResourceArgs {
  uri: string;
}

/** Arguments of a prompt get. */
interface PromptArgs {
  prompt: string;
  arguments?: unknown;
}

/** A field that names one server. */
interface ServerArgs {
  name: string;
}

/** A field that names one workspace. */
interface WorkspaceArgs {
  slug: string;
}

/** The `name` argument of a call made on one server. */
const NAME_ARG = { name: { type: new GraphQLNonNull(GraphQLString), description: "The server's name." } };

/** The `slug` argument of a call made through a workspace. */
const SLUG_ARG = { slug: { type: new GraphQLNonNull(GraphQLString), description: "The workspace's slug." } };

/**
 * The arguments of a tool call.
 *
 * @param naming - How the tool is named in this scope.
 * @returns The `tool` and `arguments` arguments.
 */
const toolArgs = (naming: string): GraphQLFieldConfigArgumentMap => ({
  tool: { type: new GraphQLNonNull(GraphQLString), description: `The tool's name, ${naming}.` },
  arguments: { type: GraphQLJSON, description: "The tool's arguments as a JSON object, matching its inputSchema." },
});

/**
 * The argument of a resource read.
 *
 * @param naming - How the resource is named in this scope.
 * @returns The `uri` argument.
 */
const resourceArgs = (naming: string): GraphQLFieldConfigArgumentMap => ({
  uri: {
    type: new GraphQLNonNull(GraphQLString),
    description: `The resource's URI, ${naming}: a listed resource's, or one expanded from a template.`,
  },
});

/**
 * The arguments of a prompt get.
 *
 * @param naming - How the prompt is named in this scope.
 * @returns The `prompt` and `arguments` arguments.
 */
const promptArgs = (naming: string): GraphQLFieldConfigArgumentMap => ({
  prompt: { type: new GraphQLNonNull(GraphQLString), description: `The prompt's name, ${naming}.` },
  arguments: { type: GraphQLJSON, description: "The prompt's arguments as a JSON object of strings." },
});

/** How a server's own names are written. */
const SERVER_NAMING = 'as the server names it';
/** How a workspace's names are written. */
const WORKSPACE_NAMING = 'prefixed `<server>__` as the workspace aggregate names it';

/**
 * Calls a tool and reads its result into `McpToolResult`.
 *
 * @param ctx - The request.
 * @param locate - Where the call lands.
 * @param args - The field's arguments.
 * @returns The content, structured content and error flag.
 */
async function toolResult(ctx: Context, locate: LocateUiCall, args: ToolArgs) {
  const request = parseOrThrow(toolCallRequestSchema, { name: args.tool, arguments: args.arguments ?? {} }, 'Call');
  const result = await callUiTool(ctx.manager, locate, request);
  return {
    content: Array.isArray(result.content) ? result.content : [],
    structuredContent: result.structuredContent ?? null,
    isError: result.isError === true,
  };
}

/**
 * Reads a resource into `McpResourceContents`.
 *
 * @param ctx - The request.
 * @param locate - Where the call lands.
 * @param args - The field's arguments.
 * @returns The contents.
 */
async function resourceResult(ctx: Context, locate: LocateUiCall, args: ResourceArgs) {
  const request = parseOrThrow(resourceReadRequestSchema, { uri: args.uri }, 'Read');
  const result = await readUiResource(ctx.manager, locate, request);
  return { contents: result.contents };
}

/**
 * Renders a prompt into `McpPromptMessages`.
 *
 * @param ctx - The request.
 * @param locate - Where the call lands.
 * @param args - The field's arguments.
 * @returns The description and messages.
 */
async function promptResult(ctx: Context, locate: LocateUiCall, args: PromptArgs) {
  const request = parseOrThrow(
    promptGetRequestSchema,
    { name: args.prompt, arguments: args.arguments ?? {} },
    'Prompt',
  );
  const result = await getUiPrompt(ctx.manager, locate, request);
  return { description: result.description ?? null, messages: result.messages };
}

/**
 * Places a call on one server, once the gateway knows it.
 *
 * @param ctx - The request.
 * @param name - The server's name.
 * @returns The locator. Throws NOT_FOUND for an unknown server.
 */
const onServer = (ctx: Context, name: string): LocateUiCall => locateOnServer(requireServerName(ctx, name));

/**
 * Places a call in a workspace.
 *
 * @param ctx - The request.
 * @param slug - The workspace's slug.
 * @returns The locator. Throws NOT_FOUND for an unknown workspace.
 */
const inWorkspace = (ctx: Context, slug: string): LocateUiCall =>
  locateInWorkspace(requireWorkspace(ctx, slug), ctx.store);

/**
 * The try-it mutations, for one server and for a workspace's aggregate.
 *
 * @returns The fields, for the Mutation root.
 */
export function uiCallMutations(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    callServerTool: handField<ServerArgs & ToolArgs>({
      type: new GraphQLNonNull(McpToolResultType),
      description:
        "Calls one of a server's tools, starting it if it is stopped, and records the call in its activity. A tool that reports its own failure answers with isError; a server that fails answers UPSTREAM_FAILED.",
      args: { ...NAME_ARG, ...toolArgs(SERVER_NAMING) },
      resolve: (args, ctx) => toolResult(ctx, onServer(ctx, args.name), args),
    }),
    readServerResource: handField<ServerArgs & ResourceArgs>({
      type: new GraphQLNonNull(McpResourceContentsType),
      description: "Reads one of a server's resources, starting it if it is stopped, and records the read.",
      args: { ...NAME_ARG, ...resourceArgs(SERVER_NAMING) },
      resolve: (args, ctx) => resourceResult(ctx, onServer(ctx, args.name), args),
    }),
    getServerPrompt: handField<ServerArgs & PromptArgs>({
      type: new GraphQLNonNull(McpPromptMessagesType),
      description: "Renders one of a server's prompts with its arguments, starting it if it is stopped.",
      args: { ...NAME_ARG, ...promptArgs(SERVER_NAMING) },
      resolve: (args, ctx) => promptResult(ctx, onServer(ctx, args.name), args),
    }),
    callWorkspaceTool: handField<WorkspaceArgs & ToolArgs>({
      type: new GraphQLNonNull(McpToolResultType),
      description:
        "Calls a tool through a workspace: the `<server>__` prefix picks the member, whose workspace instance (with the workspace's overrides) runs it and records it. A prefix naming no member is BAD_USER_INPUT.",
      args: { ...SLUG_ARG, ...toolArgs(WORKSPACE_NAMING) },
      resolve: (args, ctx) => toolResult(ctx, inWorkspace(ctx, args.slug), args),
    }),
    readWorkspaceResource: handField<WorkspaceArgs & ResourceArgs>({
      type: new GraphQLNonNull(McpResourceContentsType),
      description: 'Reads a resource through a workspace, on the member its `<server>__` prefix names.',
      args: { ...SLUG_ARG, ...resourceArgs(WORKSPACE_NAMING) },
      resolve: (args, ctx) => resourceResult(ctx, inWorkspace(ctx, args.slug), args),
    }),
    getWorkspacePrompt: handField<WorkspaceArgs & PromptArgs>({
      type: new GraphQLNonNull(McpPromptMessagesType),
      description: 'Renders a prompt through a workspace, on the member its `<server>__` prefix names.',
      args: { ...SLUG_ARG, ...promptArgs(WORKSPACE_NAMING) },
      resolve: (args, ctx) => promptResult(ctx, inWorkspace(ctx, args.slug), args),
    }),
  };
}
