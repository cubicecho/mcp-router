import { maxAliasesRule } from '@escape.tech/graphql-armor-max-aliases';
import { maxDepthRule } from '@escape.tech/graphql-armor-max-depth';
import { ErrorCode } from '@mcp-router/shared';
import { type DocumentNode, GraphQLError, type GraphQLSchema, TypeNameMetaFieldDef, validate } from 'graphql';
import {
  type ComplexityEstimator,
  fieldExtensionsEstimator,
  getComplexity,
  simpleEstimator,
} from 'graphql-query-complexity';
import type { Plugin } from 'graphql-yoga';
import { OPERATION_LIMIT_DEFAULTS, type OperationLimitSettings } from '../core/defaults.ts';
import { codedError } from '../core/errors.ts';

// The generated schema answers whatever shape it is asked for, and its relations form a cycle
// (workspace → members → workspace), so one request could ask for the database several times over.
// Each bound here stops a different way of doing that.

/** What pricing an operation needs from the request. */
interface Operation {
  schema: GraphQLSchema;
  document: DocumentNode;
  operationName?: string;
  variables?: Record<string, unknown>;
}

/**
 * Prices `__typename` at nothing: it is answered from the row already in hand.
 *
 * @param options - The field being priced.
 * @returns 0 for `__typename`; nothing otherwise, so the next estimator prices it.
 */
const typenameEstimator: ComplexityEstimator = ({ field }) =>
  field.name === TypeNameMetaFieldDef.name ? 0 : undefined;

/**
 * What an operation could cost, or 0 when its variables do not fit their types: execution reports those, and such a
 * request runs nothing.
 *
 * @param operation - The schema, document, operation name and variables of one request.
 * @param settings - The limits in force; only the default field cost is read.
 * @returns The cost.
 */
function priceOf({ schema, document, operationName, variables = {} }: Operation, settings: OperationLimitSettings) {
  try {
    return getComplexity({
      schema,
      query: document,
      operationName,
      variables,
      estimators: [
        typenameEstimator,
        // drizzle-graphql's hints, and the ones on the hand-written lists (graphql/page.ts).
        fieldExtensionsEstimator(),
        simpleEstimator({ defaultComplexity: settings.defaultFieldCost }),
      ],
    });
  } catch (error) {
    if (error instanceof GraphQLError) {
      return 0;
    }
    throw error;
  }
}

/**
 * Builds the refusal every bound answers with.
 *
 * @param message - What was over which bound.
 * @returns QUERY_TOO_COMPLEX.
 */
const tooComplex = (message: string): GraphQLError => codedError(ErrorCode.QueryTooComplex, message);

/**
 * Throws QUERY_TOO_COMPLEX when an operation is too deep, uses too many aliases, or could cost more than `maxCost`.
 *
 * @param operation - The validated document, with the schema and variables it runs against.
 * @param settings - The bounds to hold it to.
 */
export function assertWithinLimits(operation: Operation, settings: OperationLimitSettings): void {
  const { schema, document } = operation;
  // Each armor rule throws our error in place of its own, so one code covers all three bounds.
  const refuse = (message: string) => () => {
    throw tooComplex(message);
  };
  validate(schema, document, [
    maxDepthRule({
      n: settings.maxDepth,
      flattenFragments: true,
      propagateOnRejection: false,
      onReject: [refuse(`A query may nest at most ${settings.maxDepth} levels deep.`)],
    }),
    maxAliasesRule({
      n: settings.maxAliases,
      propagateOnRejection: false,
      onReject: [refuse(`A query may use at most ${settings.maxAliases} aliases.`)],
    }),
  ]);
  const cost = priceOf(operation, settings);
  if (cost > settings.maxCost) {
    throw tooComplex(`This query costs ${cost}; the most one may cost is ${settings.maxCost}. Ask for fewer rows.`);
  }
}

/**
 * The Yoga plugin that holds every operation to the limits, once it is validated and before anything executes.
 *
 * @param [overrides] - Bounds to use in place of `OPERATION_LIMIT_DEFAULTS`.
 * @returns The plugin, for `createYoga({ plugins })`.
 */
export function operationLimitsPlugin(overrides: Partial<OperationLimitSettings> = {}): Plugin {
  const settings = { ...OPERATION_LIMIT_DEFAULTS, ...overrides };
  return {
    onExecute: ({ args }) => {
      assertWithinLimits(
        {
          schema: args.schema,
          document: args.document,
          operationName: args.operationName ?? undefined,
          variables: args.variableValues ?? undefined,
        },
        settings,
      );
    },
  };
}
