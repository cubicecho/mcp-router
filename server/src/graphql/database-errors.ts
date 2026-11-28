import { ErrorCode } from '@mcp-router/shared';
import { defaultErrorMapper } from '@vantreeseba/drizzle-graphql';
import type { GraphQLError } from 'graphql';
import { codedError } from '../core/errors.ts';

/** Postgres's code for a unique violation. */
const PG_UNIQUE_VIOLATION = '23505';
/** Postgres's code for a foreign key violation. */
const PG_FOREIGN_KEY_VIOLATION = '23503';

/** What a caller is told when a write breaks a unique index, by the index's name. */
const UNIQUE_MESSAGES: Readonly<Record<string, string>> = {
  uq_servers_name: 'A server with that name already exists.',
  uq_workspaces_slug: 'A workspace with that slug already exists.',
  uq_registries_name: 'A registry with that name already exists.',
  uq_workspace_members_workspace_id_server_id: 'That server is already a member of the workspace.',
};

/** What a caller is told when a write points at a row that is not there. */
const FOREIGN_KEY_MESSAGE = 'A member names a server or workspace that does not exist.';

/** The parts of a driver error this reads. */
interface PgErrorFields {
  code?: unknown;
  constraint?: unknown;
}

/**
 * Finds the Postgres error under whatever wrapped it.
 *
 * @param error - What a query threw. Drizzle puts the driver's error on `cause`, and GraphQL on `originalError`.
 * @returns The driver error's fields, or null when there is none.
 */
function pgErrorOf(error: unknown): PgErrorFields | null {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    if ('constraint' in current) {
      return current;
    }
    current = 'cause' in current ? current.cause : 'originalError' in current ? current.originalError : null;
  }
  return null;
}

/**
 * Turns a broken constraint a person can fix into a coded error.
 *
 * @param error - What a write threw.
 * @returns CONFLICT for a taken name or slug, BAD_USER_INPUT for a member pointing nowhere, or undefined for anything
 * else.
 */
export function constraintError(error: unknown): GraphQLError | undefined {
  const pgError = pgErrorOf(error);
  const constraint = typeof pgError?.constraint === 'string' ? pgError.constraint : '';
  const uniqueMessage = UNIQUE_MESSAGES[constraint];
  if (pgError?.code === PG_UNIQUE_VIOLATION && uniqueMessage !== undefined) {
    return codedError(ErrorCode.Conflict, uniqueMessage);
  }
  if (pgError?.code === PG_FOREIGN_KEY_VIOLATION) {
    return codedError(ErrorCode.BadUserInput, FOREIGN_KEY_MESSAGE);
  }
  return undefined;
}

/**
 * The generated resolvers' error mapper: a broken constraint is coded, the rest is left to drizzle-graphql's masking.
 *
 * @param error - What a generated resolver threw.
 * @returns The error the caller sees.
 */
export function mapDatabaseError(error: unknown): unknown {
  return constraintError(error) ?? defaultErrorMapper(error);
}
