import { ErrorCode } from '@mcp-router/shared';
import {
  type GraphQLFieldConfig,
  type GraphQLFieldConfigArgumentMap,
  GraphQLInt,
  type GraphQLOutputType,
  type GraphQLResolveInfo,
} from 'graphql';
import type { ComplexityEstimatorArgs } from 'graphql-query-complexity';
import type { Context } from '../core/context.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { asGraphQLError, codedError } from '../core/errors.ts';

const { defaultPageSize, maxPageSize } = OPERATION_LIMIT_DEFAULTS;

/** The `limit` argument every hand-written list takes. */
export interface PageArgs {
  limit?: number | null;
}

/**
 * Reads how many items a hand-written list returns.
 *
 * @param limit - The request's `limit`, if it named one.
 * @returns `defaultPageSize` when none was named, never more than `maxPageSize`.
 * @throws BAD_USER_INPUT for a negative limit.
 */
export function pageSize(limit: number | null | undefined): number {
  const isNegative = limit !== null && limit !== undefined && limit < 0;
  if (isNegative) {
    throw codedError(ErrorCode.BadUserInput, 'A limit cannot be negative.');
  }
  return Math.min(limit ?? defaultPageSize, maxPageSize);
}

/**
 * Cuts a list to one page.
 *
 * @typeParam T - The listed item.
 * @param items - Everything there is.
 * @param limit - The request's `limit`.
 * @returns The first page.
 */
export function page<T>(items: readonly T[], limit: number | null | undefined): T[] {
  return items.slice(0, pageSize(limit));
}

/** What a hand-written field is built from. */
export interface HandFieldConfig<TArgs> {
  type: GraphQLOutputType;
  /** What the field does. Agents read it as the tool's documentation on /admin/mcp. */
  description: string;
  args?: GraphQLFieldConfigArgumentMap;
  /** A list: takes `limit`, and is priced at a page of what it selects. */
  paged?: boolean;
  /**
   * Answers the field. A coded REST error it throws keeps its code.
   *
   * @param args - The field's arguments.
   * @param ctx - The request.
   * @param info - The resolve info, for fields that return a generated type.
   * @returns The field's value.
   */
  resolve: (args: TArgs, ctx: Context, info: GraphQLResolveInfo) => unknown;
}

/**
 * Prices a paged field at a page of its selection, so `operationLimitsPlugin` counts what it can return.
 *
 * @param options - The field's arguments and the cost of one item.
 * @returns The field's cost.
 */
function pagedComplexity({ args, childComplexity }: ComplexityEstimatorArgs): number {
  const limit: unknown = args.limit;
  return pageSize(typeof limit === 'number' ? limit : undefined) * childComplexity;
}

/**
 * Builds one hand-written root field.
 *
 * @typeParam TArgs - The field's arguments, as its `args` declare them.
 * @param config - Its type, description, arguments and resolver.
 * @returns The field config, for a root type's `fields`.
 */
export function handField<TArgs>(config: HandFieldConfig<TArgs>): GraphQLFieldConfig<unknown, Context, TArgs> {
  const { type, description, paged = false, resolve } = config;
  const limitArg = {
    limit: {
      type: GraphQLInt,
      description: `At most this many; ${defaultPageSize} when left out, at most ${maxPageSize}.`,
    },
  };
  return {
    type,
    description,
    args: paged ? { ...config.args, ...limitArg } : config.args,
    extensions: paged ? { complexity: pagedComplexity } : undefined,
    resolve: async (_source, args, ctx, info) => {
      try {
        return await resolve(args, ctx, info);
      } catch (error) {
        throw asGraphQLError(error);
      }
    },
  };
}
