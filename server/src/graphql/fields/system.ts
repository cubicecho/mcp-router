import { type DiscoveryResponse, ErrorCode, type Registry, setDismissedRequestSchema } from '@mcp-router/shared';
import { GraphQLJSON } from '@vantreeseba/drizzle-graphql';
import { eq } from 'drizzle-orm';
import { GraphQLBoolean, type GraphQLFieldConfigMap, GraphQLNonNull, GraphQLString } from 'graphql';
import { applyConfig } from '../../api/deps.ts';
import type { Context } from '../../core/context.ts';
import { codedError } from '../../core/errors.ts';
import { parseOrThrow } from '../../core/validation.ts';
import { SETTINGS_ROW_ID, settings } from '../../db/tables/settings.ts';
import { withDismissed } from '../../discovery/lan-servers.ts';
import { routerStatus } from '../../gateway/router-status.ts';
import { handField, type PageArgs, page, pageSize } from '../hand-field.ts';
import { LanDiscoveryType, RegistryServerPageType, ReloadResultType, RouterStatusType } from '../types.ts';
import { settleWrite } from '../write-hooks.ts';

/** The arguments of `lanServers`. */
type LanArgs = PageArgs;

/** The arguments of `setLanServerDismissed`. */
interface DismissArgs {
  key: string;
  dismissed: boolean;
}

/** The arguments of `registryServers`. */
interface RegistryListArgs extends PageArgs {
  registry: string;
  search?: string | null;
  cursor?: string | null;
}

/** The arguments of `registryServer`. */
interface RegistryEntryArgs {
  registry: string;
  name: string;
}

/** The `registry` argument of the registry fields. */
const REGISTRY_ARG = {
  registry: { type: new GraphQLNonNull(GraphQLString), description: "The configured registry's name." },
};

/**
 * Finds a configured registry, as the installer does.
 *
 * @param ctx - The request.
 * @param name - The registry's name.
 * @returns It.
 * @throws NOT_FOUND when there is none.
 */
function requireRegistry(ctx: Context, name: string): Registry {
  const registry = ctx.store.getRegistry(name);
  if (registry === undefined) {
    throw codedError(ErrorCode.NotFound, `Unknown registry "${name}".`);
  }
  return registry;
}

/**
 * Lists the servers found on the local network, a page of them.
 *
 * @param ctx - The request.
 * @param limit - The request's `limit`.
 * @returns Whether discovery is on, and the servers.
 */
function lanDiscovery(ctx: Context, limit: number | null | undefined): DiscoveryResponse {
  return { enabled: ctx.store.getSettings().lanDiscovery, servers: page(ctx.lanServers.list(), limit) };
}

/**
 * The router-wide queries: its status, the registries it browses and the servers found on the network.
 *
 * @returns The fields, for the Query root.
 */
export function systemQueries(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    routerStatus: handField<Record<string, never>>({
      type: new GraphQLNonNull(RouterStatusType),
      description: "The router's version, uptime, server counts, and whether auth and LAN discovery are on.",
      resolve: (_args, ctx) => routerStatus(ctx.store, ctx.manager, ctx.startedAt),
    }),
    lanServers: handField<LanArgs>({
      type: new GraphQLNonNull(LanDiscoveryType),
      description:
        'The MCP servers other hosts on the local network advertise, and whether each was added or dismissed.',
      paged: true,
      resolve: ({ limit }, ctx) => lanDiscovery(ctx, limit),
    }),
    registryServers: handField<RegistryListArgs>({
      type: new GraphQLNonNull(RegistryServerPageType),
      description: "A page of a configured registry's servers, searched by name. Install one with `installServer`.",
      args: {
        ...REGISTRY_ARG,
        search: { type: GraphQLString, description: 'Matches part of a server name.' },
        cursor: { type: GraphQLString, description: "The previous page's nextCursor." },
      },
      paged: true,
      resolve: async ({ registry, search, cursor, limit }, ctx) => {
        const listed = await ctx.registryClient.listServers(requireRegistry(ctx, registry), {
          search: search ?? undefined,
          cursor: cursor ?? undefined,
          limit: pageSize(limit),
        });
        return { servers: listed.servers, nextCursor: listed.metadata?.nextCursor ?? null };
      },
    }),
    registryServer: handField<RegistryEntryArgs>({
      type: new GraphQLNonNull(GraphQLJSON),
      description: 'One entry of a registry, with its packages and remotes, as the registry API returns it.',
      args: {
        ...REGISTRY_ARG,
        name: {
          type: new GraphQLNonNull(GraphQLString),
          description: 'Its name in the registry, e.g. io.github.owner/repo.',
        },
      },
      resolve: ({ registry, name }, ctx) => ctx.registryClient.getServer(requireRegistry(ctx, registry), name),
    }),
  };
}

/**
 * The router-wide mutations: a config reload, and hiding or offering again a server found on the network.
 *
 * @returns The fields, for the Mutation root.
 */
export function systemMutations(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    reloadConfig: handField<Record<string, never>>({
      type: new GraphQLNonNull(ReloadResultType),
      description: 'Re-reads the stored config and reconciles the running servers to it.',
      resolve: async (_args, ctx) => {
        const state = await ctx.store.reload();
        await applyConfig(ctx);
        return { reloaded: true, serverCount: state.servers.length };
      },
    }),
    setLanServerDismissed: handField<DismissArgs & PageArgs>({
      type: new GraphQLNonNull(LanDiscoveryType),
      description:
        'Hides a server found on the network from the offer (`dismissed: true`), or offers it again. Answers with the servers found.',
      args: {
        key: { type: new GraphQLNonNull(GraphQLString), description: "The found server's key." },
        dismissed: { type: new GraphQLNonNull(GraphQLBoolean) },
      },
      paged: true,
      resolve: async ({ key, dismissed, limit }, ctx) => {
        const request = parseOrThrow(setDismissedRequestSchema, { key, dismissed }, 'Dismissal');
        const [row] = await ctx.db.select({ lanDismissed: settings.lanDismissed }).from(settings).limit(1);
        if (row === undefined) {
          throw new Error('The settings row is missing.');
        }
        const lanDismissed = withDismissed(row.lanDismissed, request.key, request.dismissed);
        await ctx.db.update(settings).set({ lanDismissed }).where(eq(settings.id, SETTINGS_ROW_ID));
        await settleWrite(ctx);
        return lanDiscovery(ctx, limit);
      },
    }),
  };
}
