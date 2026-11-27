import { ErrorCode, serverNameSchema, slugify, workspaceConfigSchema, workspaceMemberSchema } from '@mcp-router/shared';
import { eq } from 'drizzle-orm';
import {
  GraphQLBoolean,
  type GraphQLFieldConfigMap,
  GraphQLNonNull,
  type GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { z } from 'zod';
import type { Context } from '../../core/context.ts';
import { codedError } from '../../core/errors.ts';
import { parseOrThrow } from '../../core/validation.ts';
import { workspaceMembers } from '../../db/tables/workspace-members.ts';
import { workspaces } from '../../db/tables/workspaces.ts';
import {
  clearWorkspaceActivity,
  listWorkspacePrompts,
  listWorkspaceResources,
  listWorkspaceTools,
  workspaceActivity,
} from '../../gateway/listings.ts';
import { constraintError } from '../database-errors.ts';
import { handField, type PageArgs, page } from '../hand-field.ts';
import { requireWorkspace, selectedRow } from '../lookups.ts';
import {
  ActivityEntryType,
  listOf,
  McpPromptType,
  McpResourceListingType,
  McpToolType,
  SaveWorkspaceInputType,
} from '../types.ts';
import { settleWrite, withoutNulls } from '../write-hooks.ts';

/** A field that names one workspace. */
interface WorkspaceArgs {
  slug: string;
}

/** The `slug` argument of every field about one workspace. */
const SLUG_ARG = { slug: { type: new GraphQLNonNull(GraphQLString), description: "The workspace's slug." } };

/**
 * The workspace queries the generated CRUD can't answer: what its aggregate at /mcp/w/<slug> serves now. Names are
 * `<server>__`-namespaced as the aggregate shows them.
 *
 * @returns The fields, for the Query root.
 */
export function workspaceQueries(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    workspaceTools: handField<WorkspaceArgs & PageArgs>({
      type: listOf(McpToolType),
      description: "The tools a workspace's enabled members offer, each asked now on its workspace instance.",
      args: SLUG_ARG,
      paged: true,
      resolve: async ({ slug, limit }, ctx) =>
        page(await listWorkspaceTools(ctx.manager, ctx.store, requireWorkspace(ctx, slug)), limit),
    }),
    workspaceResources: handField<WorkspaceArgs & PageArgs>({
      type: new GraphQLNonNull(McpResourceListingType),
      description: "The resources and templates a workspace's enabled members offer. `limit` applies to each.",
      args: SLUG_ARG,
      paged: true,
      resolve: async ({ slug, limit }, ctx) => {
        const listing = await listWorkspaceResources(ctx.manager, ctx.store, requireWorkspace(ctx, slug));
        return { resources: page(listing.resources, limit), resourceTemplates: page(listing.resourceTemplates, limit) };
      },
    }),
    workspacePrompts: handField<WorkspaceArgs & PageArgs>({
      type: listOf(McpPromptType),
      description: "The prompts a workspace's enabled members offer.",
      args: SLUG_ARG,
      paged: true,
      resolve: async ({ slug, limit }, ctx) =>
        page(await listWorkspacePrompts(ctx.manager, ctx.store, requireWorkspace(ctx, slug)), limit),
    }),
    workspaceActivity: handField<WorkspaceArgs & PageArgs>({
      type: listOf(ActivityEntryType),
      description: 'The calls recorded for every member of a workspace, newest first, kept in memory only.',
      args: SLUG_ARG,
      paged: true,
      resolve: ({ slug, limit }, ctx) =>
        page(workspaceActivity(ctx.manager, ctx.store, requireWorkspace(ctx, slug)), limit),
    }),
  };
}

/** One member of `saveWorkspace`'s input: the member's config file entry, and the server it is for. */
const saveMemberSchema = workspaceMemberSchema.extend({ serverId: z.uuid() });

/** `saveWorkspace`'s input, checked against the rules the workspace files are. */
const saveWorkspaceSchema = z.object({
  id: z.uuid().optional(),
  name: workspaceConfigSchema.shape.name,
  slug: serverNameSchema.optional(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  members: z.array(saveMemberSchema),
});

/** What `saveWorkspace` writes, once checked. */
type SaveWorkspace = z.infer<typeof saveWorkspaceSchema>;

/** The arguments of `saveWorkspace`. */
interface SaveArgs {
  input: Record<string, unknown> & { members?: unknown };
}

/**
 * Reads `saveWorkspace`'s input. An explicit null is a field left out.
 *
 * @param input - The input as GraphQL coerced it.
 * @returns The checked input, with its slug derived from the name when it named none.
 * @throws BAD_USER_INPUT when a rule is broken, or the name yields no valid slug.
 */
function readSaveInput(input: SaveArgs['input']): SaveWorkspace & { slug: string } {
  const members = Array.isArray(input.members) ? input.members.map((member) => withoutNulls(member)) : input.members;
  const parsed = parseOrThrow(saveWorkspaceSchema, { ...withoutNulls(input), members }, 'Workspace');
  const slug = parseOrThrow(serverNameSchema, parsed.slug ?? slugify(parsed.name), 'Workspace slug');
  return { ...parsed, slug };
}

/**
 * Writes a workspace and replaces its members, in one transaction.
 *
 * @param ctx - The request.
 * @param input - The checked input.
 * @returns The workspace's id.
 * @throws NOT_FOUND for an id that names no workspace, CONFLICT for a taken slug, BAD_USER_INPUT for a member whose
 * server does not exist or that is listed twice.
 */
async function writeWorkspace(ctx: Context, input: SaveWorkspace & { slug: string }): Promise<string> {
  const { id, members, ...columns } = input;
  const row = { ...columns, description: columns.description ?? null };
  try {
    return await ctx.db.transaction(async (tx) => {
      const [written] =
        id === undefined
          ? await tx.insert(workspaces).values(row).returning({ id: workspaces.id })
          : await tx.update(workspaces).set(row).where(eq(workspaces.id, id)).returning({ id: workspaces.id });
      if (written === undefined) {
        throw codedError(ErrorCode.NotFound, `Unknown workspace "${id}".`);
      }
      await tx.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, written.id));
      if (members.length > 0) {
        const memberRows = members.map(({ serverId, enabled, env, args, headers, url }) => ({
          workspaceId: written.id,
          serverId,
          enabled,
          env: env ?? null,
          args: args ?? null,
          headers: headers ?? null,
          url: url ?? null,
        }));
        await tx.insert(workspaceMembers).values(memberRows);
      }
      return written.id;
    });
  } catch (error) {
    throw constraintError(error) ?? error;
  }
}

/**
 * The workspace mutations CRUD can't express: saving a workspace with its whole member list at once, and clearing
 * what its members recorded.
 *
 * @param Workspace - The generated workspace type, which `saveWorkspace` answers with.
 * @returns The fields, for the Mutation root.
 */
export function workspaceMutations(Workspace: GraphQLObjectType): GraphQLFieldConfigMap<unknown, Context> {
  return {
    saveWorkspace: handField<SaveArgs>({
      type: new GraphQLNonNull(Workspace),
      description:
        'Creates a workspace, or replaces one (with `id`), together with its whole member list in one transaction. A server left out of `members` leaves the workspace.',
      args: { input: { type: new GraphQLNonNull(SaveWorkspaceInputType) } },
      resolve: async ({ input }, ctx, info) => {
        const id = await writeWorkspace(ctx, readSaveInput(input));
        await settleWrite(ctx);
        return selectedRow(info, ctx, 'workspaces', id);
      },
    }),
    clearWorkspaceActivity: handField<WorkspaceArgs>({
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'Empties the activity log of every member of a workspace. Always true.',
      args: SLUG_ARG,
      resolve: ({ slug }, ctx) => {
        clearWorkspaceActivity(ctx.manager, ctx.store, requireWorkspace(ctx, slug));
        return true;
      },
    }),
  };
}
