import {
  type ListedPrompt,
  type ListedTool,
  listAllPrompts,
  listAllResources,
  listAllResourceTemplates,
  listAllTools,
} from '@cubicecho/agent-mcp-pool';
import type { ActivityEntry, ServerResourcesResponse, WorkspaceConfig } from '@mcp-router/shared';
import { errorMessage } from '../core/errors.ts';
import { emptyOnMissing } from './capability.ts';
import type { DownstreamClient } from './downstream.ts';
import { type EndpointScope, scopedDeps, workspaceScope } from './endpoint-scope.ts';
import { collectFrom } from './fan-out.ts';
import type { GatewayManager } from './manager.ts';
import { McpMethod } from './mcp-method.ts';
import { enabledMembers, existingMembers, type ServerLookup } from './members.ts';
import { namespaceName } from './naming.ts';

// What the management doors (/graphql and /admin/mcp) list from a server or a workspace, written once for both.

/** A server's or workspace's resources and resource templates. */
export type ResourceListing = ServerResourcesResponse;

/**
 * Lists every tool of one server, draining all pages, and records the count on its status.
 *
 * @param manager - Reaches the server.
 * @param name - The server's name.
 * @returns The tools.
 */
export async function listServerTools(manager: GatewayManager, name: string): Promise<ListedTool[]> {
  const tools = await manager.withClient(name, listAllTools);
  manager.recordToolCount(name, tools.length);
  return tools;
}

/**
 * Lists one server's resources and templates. A server without the capability lists none.
 *
 * @param manager - Reaches the server.
 * @param name - The server's name.
 * @returns Both lists.
 *
 * @remarks
 * Templates are a supplementary sub-listing: a genuine failure there is logged and lists none, so it never discards a
 * successful resources list.
 */
export async function listServerResources(manager: GatewayManager, name: string): Promise<ResourceListing> {
  const [resources, templates] = await Promise.all([
    emptyOnMissing(() => manager.withClient(name, listAllResources)),
    emptyOnMissing(() => manager.withClient(name, listAllResourceTemplates)).catch((cause: unknown) => {
      console.warn(`[gateway] listing resource templates for "${name}" failed: ${errorMessage(cause)}`);
      return null;
    }),
  ]);
  return { resources: resources ?? [], resourceTemplates: templates ?? [] };
}

/**
 * Lists one server's prompts. A server without the capability lists none.
 *
 * @param manager - Reaches the server.
 * @param name - The server's name.
 * @returns The prompts.
 */
export async function listServerPrompts(manager: GatewayManager, name: string): Promise<ListedPrompt[]> {
  const prompts = await emptyOnMissing(() => manager.withClient(name, listAllPrompts));
  return prompts ?? [];
}

/**
 * The scope the /mcp/w/<slug> aggregate serves, taken from the workspace as the caller read it.
 *
 * @param workspace - The workspace.
 * @param servers - Tells which members' servers still exist.
 * @returns Its enabled members, each reaching its own instance in the workspace.
 */
export function workspaceEndpointScope(workspace: WorkspaceConfig, servers: ServerLookup): EndpointScope {
  return workspaceScope(workspace.slug, () => enabledMembers(workspace, servers));
}

/**
 * Fans a listing out over a workspace's enabled members, as the /mcp/w/<slug> aggregate does.
 *
 * @typeParam T - The listed item.
 * @param manager - Reaches each member's workspace instance.
 * @param scope - The workspace's scope.
 * @param slug - The workspace's slug, for the warning line.
 * @param method - The MCP method, as recorded in the activity log.
 * @param list - Lists one member's items.
 * @returns Every member's items; a failing member contributes none.
 */
function collectFromMembers<T>(
  manager: GatewayManager,
  scope: EndpointScope,
  slug: string,
  method: string,
  list: (client: DownstreamClient, name: string) => Promise<T[]>,
): Promise<T[]> {
  return collectFrom(
    scope.names(),
    method,
    scopedDeps(manager, scope),
    list,
    (name) => `member "${name}" of workspace "${slug}"`,
  );
}

/**
 * Lists a workspace's tools, `<server>__`-namespaced as its aggregate shows them.
 *
 * @param manager - Reaches each member's workspace instance.
 * @param servers - Tells which members' servers still exist.
 * @param workspace - The workspace.
 * @returns The tools of every enabled member.
 */
export function listWorkspaceTools(
  manager: GatewayManager,
  servers: ServerLookup,
  workspace: WorkspaceConfig,
): Promise<ListedTool[]> {
  const scope = workspaceEndpointScope(workspace, servers);
  return collectFromMembers(manager, scope, workspace.slug, McpMethod.ToolsList, async (client, name) => {
    const all = await listAllTools(client);
    manager.recordToolCount(scope.keyFor(name), all.length);
    return all.map((tool) => ({ ...tool, name: namespaceName(name, tool.name) }));
  });
}

/**
 * Lists a workspace's resources and templates, `<server>__`-namespaced as its aggregate shows them.
 *
 * @param manager - Reaches each member's workspace instance.
 * @param servers - Tells which members' servers still exist.
 * @param workspace - The workspace.
 * @returns Both lists, over every enabled member.
 */
export async function listWorkspaceResources(
  manager: GatewayManager,
  servers: ServerLookup,
  workspace: WorkspaceConfig,
): Promise<ResourceListing> {
  const scope = workspaceEndpointScope(workspace, servers);
  const [resources, resourceTemplates] = await Promise.all([
    collectFromMembers(manager, scope, workspace.slug, McpMethod.ResourcesList, async (client, name) => {
      const all = await emptyOnMissing(() => listAllResources(client));
      return (all ?? []).map((resource) => ({
        ...resource,
        uri: namespaceName(name, resource.uri),
        name: resource.name === undefined ? undefined : namespaceName(name, resource.name),
      }));
    }),
    collectFromMembers(manager, scope, workspace.slug, McpMethod.ResourceTemplatesList, async (client, name) => {
      const all = await emptyOnMissing(() => listAllResourceTemplates(client));
      return (all ?? []).map((template) => ({
        ...template,
        uriTemplate: namespaceName(name, template.uriTemplate),
        name: template.name === undefined ? undefined : namespaceName(name, template.name),
      }));
    }),
  ]);
  return { resources, resourceTemplates };
}

/**
 * Lists a workspace's prompts, `<server>__`-namespaced as its aggregate shows them.
 *
 * @param manager - Reaches each member's workspace instance.
 * @param servers - Tells which members' servers still exist.
 * @param workspace - The workspace.
 * @returns The prompts of every enabled member.
 */
export function listWorkspacePrompts(
  manager: GatewayManager,
  servers: ServerLookup,
  workspace: WorkspaceConfig,
): Promise<ListedPrompt[]> {
  const scope = workspaceEndpointScope(workspace, servers);
  return collectFromMembers(manager, scope, workspace.slug, McpMethod.PromptsList, async (client, name) => {
    const all = await emptyOnMissing(() => listAllPrompts(client));
    return (all ?? []).map((prompt) => ({ ...prompt, name: namespaceName(name, prompt.name) }));
  });
}

/**
 * Merges the activity of every member instance of a workspace, newest first.
 *
 * @param manager - Holds each instance's log.
 * @param servers - Tells which members' servers still exist.
 * @param workspace - The workspace.
 * @returns The entries. Ids are monotonic per process, so a descending id sort orders across members.
 */
export function workspaceActivity(
  manager: GatewayManager,
  servers: ServerLookup,
  workspace: WorkspaceConfig,
): ActivityEntry[] {
  const scope = workspaceEndpointScope(workspace, servers);
  return existingMembers(workspace, servers)
    .flatMap((name) => manager.getActivity(scope.keyFor(name)))
    .sort((a, b) => b.id - a.id);
}

/**
 * Empties the activity log of every member instance of a workspace.
 *
 * @param manager - Holds each instance's log.
 * @param servers - Tells which members' servers still exist.
 * @param workspace - The workspace.
 */
export function clearWorkspaceActivity(
  manager: GatewayManager,
  servers: ServerLookup,
  workspace: WorkspaceConfig,
): void {
  const scope = workspaceEndpointScope(workspace, servers);
  for (const name of existingMembers(workspace, servers)) {
    manager.clearActivity(scope.keyFor(name));
  }
}
