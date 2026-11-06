import { type AdvertisedEndpoint, airIdentifier, createServerCard, type KeyValueInput } from '@cubicecho/mcp-discovery';
import { type ServerConfig, SourceType, type WorkspaceConfig } from '@mcp-router/shared';
import { effectiveAuth } from '../auth/middleware.ts';
import type { ConfigStore } from '../config/store.ts';
import { SERVER_VERSION } from '../core/version.ts';

/** The reverse-DNS namespace every card's name starts with; the instance id is appended to it. */
const CARD_NAMESPACE = 'io.github.cubicecho.mcp-router';

/**
 * The `_meta` key that marks a card as served by a router, holding which kind of endpoint it is.
 *
 * @remarks
 * Another router skips every card that has it, so two routers never add each other's endpoints in a loop.
 */
export const ROUTER_ROLE_META_KEY = 'io.github.cubicecho.mcp-router/role';

/** The `_meta` key holding a proxied server's own registry name, e.g. `io.github.upstash/context7`. */
const UPSTREAM_META_KEY = 'io.github.cubicecho.mcp-router/upstream';

/** Which kind of router endpoint a card describes. */
const RouterRole = { Aggregate: 'aggregate', Server: 'server', Workspace: 'workspace' } as const;

/** The project's source, shown on every card. */
const REPOSITORY = { url: 'https://github.com/cubicecho/mcp-router', source: 'github' } as const;

/** The longest `description` and `title` a Server Card allows, in characters. */
const CARD_TEXT_MAX_LENGTH = 100;

/** The path of the aggregate endpoint. */
const AGGREGATE_PATH = '/mcp';

/** The header a client must send when bearer auth is on; its value is never in the card. */
const AUTH_HEADER: KeyValueInput = {
  name: 'Authorization',
  description: 'Bearer <token>, the router token from settings.json or MCP_ROUTER_TOKEN',
  isRequired: true,
  isSecret: true,
};

/**
 * Text cut to what a card field holds, with an ellipsis when it had to be cut.
 *
 * @param text - Any text.
 * @returns At most 100 characters.
 */
function cardText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CARD_TEXT_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, CARD_TEXT_MAX_LENGTH - 1).trimEnd()}…`;
}

/** What one endpoint's card says besides its URL. */
interface EndpointCard {
  path: string;
  /** The endpoint's name in the card's name and catalog id, e.g. `aggregate`, `context7`, `w-team`. */
  name: string;
  title: string;
  description: string;
  meta: Record<string, string>;
}

/**
 * The endpoint for one enabled server.
 *
 * @param server - Its config.
 * @returns What its card says.
 */
function serverEndpoint(server: ServerConfig): EndpointCard {
  const meta: Record<string, string> = { [ROUTER_ROLE_META_KEY]: RouterRole.Server };
  if (server.source.type === SourceType.Registry) {
    meta[UPSTREAM_META_KEY] = server.source.serverName;
  }
  return {
    path: `${AGGREGATE_PATH}/${server.name}`,
    name: server.name,
    title: cardText(server.displayName ?? server.name),
    description: cardText(server.description || `The ${server.name} MCP server, through mcp-router.`),
    meta,
  };
}

/**
 * The endpoint for one enabled workspace.
 *
 * @param workspace - Its config.
 * @returns What its card says.
 */
function workspaceEndpoint(workspace: WorkspaceConfig): EndpointCard {
  return {
    path: `${AGGREGATE_PATH}/w/${workspace.slug}`,
    name: `w-${workspace.slug}`,
    title: cardText(workspace.name),
    description: cardText(workspace.description || `The ${workspace.name} workspace's servers, through mcp-router.`),
    meta: { [ROUTER_ROLE_META_KEY]: RouterRole.Workspace },
  };
}

/**
 * The MCP endpoints the router makes discoverable: the aggregate, every enabled server and every enabled workspace.
 *
 * @param store - Where the servers, workspaces and settings are read from; read on every call.
 * @returns The endpoints, each with a card builder that names the URL the request came in on.
 */
export function discoveryEndpoints(store: ConfigStore): AdvertisedEndpoint[] {
  const settings = store.getSettings();
  const instance = settings.instanceId ?? 'router';
  const headers = effectiveAuth(settings).enabled ? [AUTH_HEADER] : [];
  const aggregate: EndpointCard = {
    path: AGGREGATE_PATH,
    name: 'aggregate',
    title: cardText(`MCP Router on ${instance}`),
    description: 'Every enabled server behind this mcp-router, with tools named <server>__<tool>.',
    meta: { [ROUTER_ROLE_META_KEY]: RouterRole.Aggregate },
  };
  const cards = [
    aggregate,
    ...store
      .getServers()
      .filter((server) => server.enabled)
      .map(serverEndpoint),
    ...store
      .getWorkspaces()
      .filter((workspace) => workspace.enabled)
      .map(workspaceEndpoint),
  ];
  return cards.map(({ path, name, title, description, meta }) => ({
    path,
    identifier: airIdentifier(`${instance}.mcp-router`, name),
    card: ({ endpointUrl }) =>
      createServerCard({
        name: `${CARD_NAMESPACE}.${instance}/${name}`,
        version: SERVER_VERSION,
        title,
        description,
        repository: REPOSITORY,
        remotes: [{ type: 'streamable-http', url: endpointUrl, headers }],
        _meta: meta,
      }),
  }));
}
