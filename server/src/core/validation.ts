import { ErrorCode } from '@mcp-router/shared';
import type { GraphQLError } from 'graphql';
import type { z } from 'zod';
import { codedError } from './errors.ts';

/**
 * Parses untrusted input with a shared schema, refusing it as BAD_USER_INPUT.
 *
 * @typeParam T - What the schema parses to.
 * @param schema - The zod schema, from `@mcp-router/shared`.
 * @param value - Untrusted input.
 * @param [label] - What the value is, named at the start of the message: "Server", "Workspace member".
 * @returns The parsed value.
 * @throws BAD_USER_INPUT naming the first issue's path and message.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label = 'Input'): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw invalidInput(result.error, label);
}

/**
 * Words a zod failure for a GraphQL caller.
 *
 * @param error - The failed parse's error.
 * @param label - What the value is.
 * @returns BAD_USER_INPUT naming the first issue, with every issue in `extensions.detail`.
 */
function invalidInput(error: z.ZodError, label: string): GraphQLError {
  const describe = (issue: z.core.$ZodIssue): string => `${issue.path.join('.') || '(root)'}: ${issue.message}`;
  const [first] = error.issues;
  const summary = first === undefined ? 'invalid' : describe(first);
  return codedError(ErrorCode.BadUserInput, `${label} is invalid (${summary}).`, error.issues.map(describe).join('; '));
}
