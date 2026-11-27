import { ErrorCode, type ServerStatus, type WorkspaceConfig } from '@mcp-router/shared';
import { resolveSelection, singularizeMapper } from '@vantreeseba/drizzle-graphql';
import { eq } from 'drizzle-orm';
import type { GraphQLResolveInfo } from 'graphql';
import type { Context } from '../core/context.ts';
import { codedError } from '../core/errors.ts';
import { type ServerRow, servers } from '../db/tables/servers.ts';

// What the hand-written fields look up before they act, refused as NOT_FOUND the way the REST routes refuse it.

/** A server's live state, with the name it is reached by. */
export type ServerRuntime = Omit<ServerStatus, 'config'> & { name: string };

/**
 * Reads a server's live state from the gateway.
 *
 * @param ctx - The request.
 * @param name - The server's name.
 * @returns Its state.
 * @throws NOT_FOUND when the gateway has no such server.
 */
export function runtimeOf(ctx: Pick<Context, 'manager'>, name: string): ServerRuntime {
  const status = ctx.manager.status(name);
  if (status === undefined) {
    throw codedError(ErrorCode.NotFound, `Unknown server "${name}".`);
  }
  return runtimeFrom(status);
}

/**
 * Drops the config from a server's status: `Server` already serves it, without the sign-in's tokens.
 *
 * @param status - The status the gateway reports.
 * @returns The live part, with the server's name.
 */
export function runtimeFrom({ config, ...live }: ServerStatus): ServerRuntime {
  return { ...live, name: config.name };
}

/**
 * Finds a server the gateway runs, by name.
 *
 * @param ctx - The request.
 * @param name - The server's name.
 * @returns Its name, once the gateway knows it.
 * @throws NOT_FOUND when the store or the gateway has no such server.
 */
export function requireServerName(ctx: Pick<Context, 'store' | 'manager'>, name: string): string {
  const isKnown = ctx.store.getServer(name) !== undefined && ctx.manager.status(name) !== undefined;
  if (isKnown) {
    return name;
  }
  throw codedError(ErrorCode.NotFound, `Unknown server "${name}".`);
}

/**
 * Finds a workspace as the gateway serves it, by slug.
 *
 * @param ctx - The request.
 * @param slug - The workspace's slug.
 * @returns Its config.
 * @throws NOT_FOUND when there is none.
 */
export function requireWorkspace(ctx: Pick<Context, 'store'>, slug: string): WorkspaceConfig {
  const workspace = ctx.store.getWorkspace(slug);
  if (workspace === undefined) {
    throw codedError(ErrorCode.NotFound, `Unknown workspace "${slug}".`);
  }
  return workspace;
}

/**
 * Reads a server's row by name.
 *
 * @param ctx - The request.
 * @param name - The server's name.
 * @returns The row.
 * @throws NOT_FOUND when there is none.
 */
export async function requireServerRow(ctx: Pick<Context, 'db'>, name: string): Promise<ServerRow> {
  const [row] = await ctx.db.select().from(servers).where(eq(servers.name, name)).limit(1);
  if (row === undefined) {
    throw codedError(ErrorCode.NotFound, `Unknown server "${name}".`);
  }
  return row;
}

/**
 * Reads one row back in the shape a field returning a generated type was asked for, relations included.
 *
 * @param info - The field's resolve info.
 * @param ctx - The request.
 * @param table - The Drizzle schema key of the row's table.
 * @param id - The row's id.
 * @returns The row as the selection wants it, or null when it is gone.
 */
export function selectedRow(info: GraphQLResolveInfo, ctx: Context, table: string, id: string): Promise<unknown> {
  return resolveSelection(info, {
    db: ctx.db,
    table,
    context: ctx,
    where: { id: { eq: id } },
    single: true,
    typeNameMapper: singularizeMapper,
  });
}
