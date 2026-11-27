import {
  ErrorCode,
  installRequestSchema,
  oauthStartRequestSchema,
  updateServerRequestSchema,
} from '@mcp-router/shared';
import { eq } from 'drizzle-orm';
import {
  GraphQLBoolean,
  type GraphQLFieldConfigMap,
  GraphQLNonNull,
  type GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { applyServerUpdate } from '../../config/server-update.ts';
import type { Context } from '../../core/context.ts';
import { codedError } from '../../core/errors.ts';
import { parseOrThrow } from '../../core/validation.ts';
import { serverConfigOf, serverValues } from '../../db/server-rows.ts';
import { servers } from '../../db/tables/servers.ts';
import { listServerPrompts, listServerResources, listServerTools } from '../../gateway/listings.ts';
import { buildInstalledConfig, resolveServerName, uninstall } from '../../installer/installer.ts';
import { constraintError } from '../database-errors.ts';
import { handField, type PageArgs, page } from '../hand-field.ts';
import { requireServerName, requireServerRow, runtimeFrom, runtimeOf, selectedRow } from '../lookups.ts';
import {
  ActivityEntryType,
  EditServerInputType,
  InstallServerInputType,
  listOf,
  McpPromptType,
  McpResourceListingType,
  McpToolType,
  OAuthStartType,
  ServerRuntimeType,
} from '../types.ts';
import { settleWrite, withoutNulls } from '../write-hooks.ts';

/** A field that names one server. */
interface ServerArgs {
  name: string;
}

/** The `name` argument of every field about one server. */
const NAME_ARG = { name: { type: new GraphQLNonNull(GraphQLString), description: "The server's name." } };

/**
 * Writes a server's row and has the gateway take it in.
 *
 * @param ctx - The request.
 * @param write - The statement. A taken name or a missing registry is refused with its code.
 * @returns The row's id.
 */
async function writeServer(ctx: Context, write: () => Promise<Array<{ id: string }>>): Promise<string> {
  let written: Array<{ id: string }>;
  try {
    written = await write();
  } catch (error) {
    throw constraintError(error) ?? error;
  }
  const [row] = written;
  if (row === undefined) {
    throw new Error('A server write returned no row.');
  }
  await settleWrite(ctx);
  return row.id;
}

/**
 * The server queries the generated CRUD can't answer: what the gateway reports about each server.
 *
 * @returns The fields, for the Query root.
 */
export function serverQueries(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    serverRuntimes: handField<PageArgs>({
      type: listOf(ServerRuntimeType),
      description: "Every server's live state: whether it runs, its last error and its call counts.",
      paged: true,
      resolve: ({ limit }, ctx) => page(ctx.manager.statusAll(), limit).map(runtimeFrom),
    }),
    serverRuntime: handField<ServerArgs>({
      type: new GraphQLNonNull(ServerRuntimeType),
      description: "One server's live state.",
      args: NAME_ARG,
      resolve: ({ name }, ctx) => runtimeOf(ctx, name),
    }),
    serverTools: handField<ServerArgs & PageArgs>({
      type: listOf(McpToolType),
      description: 'The tools a server offers, asked of it now. Starts it if it is stopped.',
      args: NAME_ARG,
      paged: true,
      resolve: async ({ name, limit }, ctx) =>
        page(await listServerTools(ctx.manager, requireServerName(ctx, name)), limit),
    }),
    serverResources: handField<ServerArgs & PageArgs>({
      type: new GraphQLNonNull(McpResourceListingType),
      description: 'The resources and resource templates a server offers, asked of it now. `limit` applies to each.',
      args: NAME_ARG,
      paged: true,
      resolve: async ({ name, limit }, ctx) => {
        const listing = await listServerResources(ctx.manager, requireServerName(ctx, name));
        return { resources: page(listing.resources, limit), resourceTemplates: page(listing.resourceTemplates, limit) };
      },
    }),
    serverPrompts: handField<ServerArgs & PageArgs>({
      type: listOf(McpPromptType),
      description: 'The prompts a server offers, asked of it now.',
      args: NAME_ARG,
      paged: true,
      resolve: async ({ name, limit }, ctx) =>
        page(await listServerPrompts(ctx.manager, requireServerName(ctx, name)), limit),
    }),
    serverActivity: handField<ServerArgs & PageArgs>({
      type: listOf(ActivityEntryType),
      description: 'The calls recorded for a server since the router started, kept in memory only.',
      args: NAME_ARG,
      paged: true,
      resolve: ({ name, limit }, ctx) => page(ctx.manager.getActivity(requireServerName(ctx, name)), limit),
    }),
  };
}

/** The arguments of `installServer`. */
interface InstallArgs {
  input: Record<string, unknown>;
}

/** The arguments of `updateServer`. */
interface UpdateArgs extends ServerArgs {
  input: unknown;
}

/** The arguments of `startServerOAuth`. */
interface OAuthStartArgs extends ServerArgs {
  origin: string;
}

/**
 * The server mutations: installing, editing and removing a server, and acting on the running one.
 *
 * @param Server - The generated server type, which the writes answer with.
 * @returns The fields, for the Mutation root.
 */
export function serverMutations(Server: GraphQLObjectType): GraphQLFieldConfigMap<unknown, Context> {
  return {
    installServer: handField<InstallArgs>({
      type: new GraphQLNonNull(Server),
      description:
        'Installs a server from a registry, npm or PyPI, or adds a remote one by its address, and starts serving it at /mcp/<name>.',
      args: { input: { type: new GraphQLNonNull(InstallServerInputType) } },
      resolve: async ({ input }, ctx, info) => {
        const request = parseOrThrow(installRequestSchema, withoutNulls(input), 'Install');
        const name = resolveServerName(request);
        const taken = await ctx.db.select({ id: servers.id }).from(servers).where(eq(servers.name, name)).limit(1);
        if (taken.length > 0) {
          throw codedError(ErrorCode.Conflict, `Server "${name}" already exists.`);
        }
        const installerDeps = {
          dataDir: ctx.dataDir,
          registryClient: ctx.registryClient,
          getRegistry: (registry: string) => ctx.store.getRegistry(registry),
        };
        const config = await buildInstalledConfig({ ...request, name }, installerDeps);
        const id = await writeServer(ctx, () =>
          ctx.db.insert(servers).values(serverValues(config)).returning({ id: servers.id }),
        );
        return selectedRow(info, ctx, 'servers', id);
      },
    }),
    updateServer: handField<UpdateArgs>({
      type: new GraphQLNonNull(Server),
      description:
        "Edits a server. Moving a remote's URL to another origin signs it out, and so does changing its OAuth client.",
      args: { ...NAME_ARG, input: { type: new GraphQLNonNull(EditServerInputType) } },
      resolve: async ({ name, input }, ctx, info) => {
        const row = await requireServerRow(ctx, name);
        const update = parseOrThrow(updateServerRequestSchema, input, 'Server edit');
        const next = applyServerUpdate(serverConfigOf(row), update);
        const id = await writeServer(ctx, () =>
          ctx.db.update(servers).set(serverValues(next)).where(eq(servers.id, row.id)).returning({ id: servers.id }),
        );
        return selectedRow(info, ctx, 'servers', id);
      },
    }),
    deleteServer: handField<ServerArgs>({
      type: new GraphQLNonNull(Server),
      description:
        'Removes a server: stops it, forgets its sign-in and deletes its installed package. Answers with it as it was.',
      args: NAME_ARG,
      resolve: async ({ name }, ctx, info) => {
        const row = await requireServerRow(ctx, name);
        const before = await selectedRow(info, ctx, 'servers', row.id);
        await ctx.db.delete(servers).where(eq(servers.id, row.id));
        // Before the uninstall: the reconcile is what closes the child, and removing its install directory out from
        // under a live process leaves a half-deleted server.
        await settleWrite(ctx);
        ctx.oauth.forget(name);
        await uninstall(ctx.dataDir, name);
        return before;
      },
    }),
    restartServer: handField<ServerArgs>({
      type: new GraphQLNonNull(ServerRuntimeType),
      description: 'Stops a server and connects it again with its current config.',
      args: NAME_ARG,
      resolve: async ({ name }, ctx) => {
        await ctx.manager.restart(requireServerName(ctx, name));
        return runtimeOf(ctx, name);
      },
    }),
    clearServerActivity: handField<ServerArgs>({
      type: new GraphQLNonNull(GraphQLBoolean),
      description: "Empties a server's in-memory activity log. Always true.",
      args: NAME_ARG,
      resolve: ({ name }, ctx) => {
        ctx.manager.clearActivity(requireServerName(ctx, name));
        return true;
      },
    }),
    startServerOAuth: handField<OAuthStartArgs>({
      type: new GraphQLNonNull(OAuthStartType),
      description:
        "Starts a remote server's OAuth sign-in. Open the answer's authorizationUrl in a window; the login sends it back to /oauth/callback.",
      args: {
        ...NAME_ARG,
        origin: {
          type: new GraphQLNonNull(GraphQLString),
          description: "The UI's own origin. The sign-in window reports back to it.",
        },
      },
      resolve: ({ name, origin }, ctx) => {
        const request = parseOrThrow(oauthStartRequestSchema, { origin }, 'Sign-in');
        return ctx.oauth.start(requireServerName(ctx, name), request.origin);
      },
    }),
    checkServerOAuth: handField<ServerArgs>({
      type: new GraphQLNonNull(ServerRuntimeType),
      description:
        'Asks a remote server, without a token, whether it wants a sign-in. The add dialog calls it after an install.',
      args: NAME_ARG,
      resolve: async ({ name }, ctx) => {
        await ctx.oauth.check(requireServerName(ctx, name));
        return runtimeOf(ctx, name);
      },
    }),
    signOutServerOAuth: handField<ServerArgs>({
      type: new GraphQLNonNull(ServerRuntimeType),
      description: "Forgets a remote server's tokens. Its next call asks for a sign-in again.",
      args: NAME_ARG,
      resolve: async ({ name }, ctx) => {
        await ctx.oauth.signOut(requireServerName(ctx, name));
        return runtimeOf(ctx, name);
      },
    }),
  };
}
