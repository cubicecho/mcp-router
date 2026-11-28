import { ErrorCode } from '@mcp-router/shared';
import type { Request } from 'express';
import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { ConflictingKeysError } from '../auth/caller.ts';
import { isProduction } from '../config/env.ts';
import type { Context, ContextFactory } from '../core/context.ts';
import { codedError } from '../core/errors.ts';
import { graphqlLogger } from './logger.ts';
import { operationLimitsPlugin } from './operation-limits.ts';

/** The path /graphql is served at. */
export const GRAPHQL_PATH = '/graphql';

/** What Express hands Yoga alongside the fetch request. */
interface ServerContext {
  /** Absent when a test calls `yoga.fetch`. */
  req?: Request;
}

/**
 * Builds the Yoga handler for /graphql.
 *
 * @param schema - The permission-wrapped schema.
 * @param contextFor - Builds a request's context; /admin/mcp uses the same one.
 * @returns The Yoga instance, callable as Express middleware.
 */
export function createGraphQLHandler(schema: GraphQLSchema, contextFor: ContextFactory) {
  return createYoga<ServerContext, Context>({
    schema,
    graphqlEndpoint: GRAPHQL_PATH,
    graphiql: isProduction() === false,
    // Masked errors are logged here with their real cause. Variables never are.
    logging: graphqlLogger,
    plugins: [operationLimitsPlugin()],
    context: async ({ request, req }) => {
      try {
        // Express's view of the client, which honours TRUST_PROXY.
        return await contextFor(request.headers, req?.ip);
      } catch (error) {
        throw error instanceof ConflictingKeysError ? codedError(ErrorCode.BadUserInput, error.message) : error;
      }
    },
  });
}
