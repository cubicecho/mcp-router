import type { IncomingMessage } from 'node:http';
import {
  createHttpHandler,
  type McpHttpHandler,
  type McpHttpRequest,
  MutationHints,
  NullBranches,
  OperationKind,
} from '@cubicecho/graphql-mcp';
import type { GraphQLInputField, GraphQLSchema } from 'graphql';
import type { ContextFactory } from '../core/context.ts';
import { MCP_DEFAULTS } from '../core/defaults.ts';
import { SERVER_VERSION } from '../core/version.ts';

// The router's own management API as MCP tools, at /admin/mcp: the same permissioned schema /graphql serves, so an
// agent can install, inspect and restart servers. Not to be confused with /mcp, which proxies the installed servers.

/** What an agent is offered. A listing, not a lock: permissions.ts is the lock. */
export const ADMIN_TOOLS: readonly string[] = Object.freeze([
  'Query.routerStatus',
  'Query.servers',
  'Query.serverRuntimes',
  'Query.serverTools',
  'Query.serverResources',
  'Query.serverPrompts',
  'Query.serverActivity',
  'Query.workspaces',
  'Query.workspaceTools',
  'Query.registries',
  'Query.registryServers',
  'Query.registryServer',
  'Query.lanServers',
  'Mutation.installServer',
  'Mutation.updateServer',
  'Mutation.deleteServer',
  'Mutation.restartServer',
  'Mutation.saveWorkspace',
  'Mutation.deleteWorkspace',
  'Mutation.reloadConfig',
]);

/** Orientation for generated fields, which only describe themselves as "the `servers` query". Keyed by tool name. */
const HINTS: Readonly<Record<string, string>> = {
  servers:
    'Every installed MCP server: how the router reaches it and whether it is on. Never its sign-in tokens. Its live state is `server_runtimes`.',
  workspaces:
    'Every workspace: a chosen set of servers served together at /mcp/w/<slug>. Save one with `save_workspace`.',
  registries: 'The registries the router can install from. Browse one with `registry_servers`.',
  delete_workspace: 'Deletes a workspace; its servers stay installed.',
};

/**
 * Says whether an input field stays in a tool's schema.
 *
 * @param field - A field of a generated input type.
 * @returns false for relation filters, which pull every related table's filter type in recursively.
 */
const isOwnColumnFilter = (field: GraphQLInputField): boolean =>
  String(field.type).includes('ListRelationFilter') === false;

/**
 * Puts the hand-written hint, when a tool has one, above its generated description.
 *
 * @param name - Tool name.
 * @param description - The generated description.
 * @returns The description an agent reads.
 */
function describeTool(name: string, description: string): string {
  const hint = HINTS[name] ?? '';
  return hint === '' ? description : `${hint}\n\n${description}`;
}

/**
 * Reads the client address Express put on the request.
 *
 * @param req - The MCP request. Mounted on Express it also carries `ip`.
 * @returns The address, or undefined off Express.
 */
function clientIp(req: McpHttpRequest): string | undefined {
  return 'ip' in req && typeof req.ip === 'string' ? req.ip : undefined;
}

/**
 * Copies Node request headers into a fetch `Headers`.
 *
 * @param req - Incoming request.
 * @returns The headers, with repeated values appended.
 */
function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    for (const one of [value ?? []].flat()) {
      headers.append(name, one);
    }
  }
  return headers;
}

/**
 * Builds the /admin/mcp handler over the permissioned schema.
 *
 * @param schema - The same instance /graphql serves.
 * @param contextFor - The context factory /graphql uses, so the caller is read the same way.
 * @returns An Express-compatible handler with `close()`.
 */
export function createAdminMcpHandler(schema: GraphQLSchema, contextFor: ContextFactory): McpHttpHandler {
  return createHttpHandler({
    schema,
    name: 'mcp-router-admin',
    version: SERVER_VERSION,
    contextFromRequest: (req) => contextFor(toHeaders(req), clientIp(req)),
    include: [...ADMIN_TOOLS],
    selectionDepth: MCP_DEFAULTS.selectionDepth,
    // readOnly and destructive hints from the create/update/delete prefixes.
    mutationHints: MutationHints.byName,
    // An explicit null on a write is how a model says "clear". On a query filter it means nothing and costs bytes.
    nullBranches: (_field, kind) => (kind === OperationKind.query ? NullBranches.never : NullBranches.always),
    inputField: isOwnColumnFilter,
    decorate: (tool) => ({ description: describeTool(tool.name, tool.description) }),
  });
}
