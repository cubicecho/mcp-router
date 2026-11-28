import {
  applyBetterAuthGraphQL,
  betterAuthGraphQL,
  type JsonSchema,
  type OperationOptions,
} from '@cubicecho/graphql-better-auth';
import { ErrorCode } from '@mcp-router/shared';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import { CALLER_AGENT, type Context } from '../core/context.ts';
import { codedError } from '../core/errors.ts';
import type { DB } from '../db/client.ts';
import { createAuth, sessionUser } from './better-auth.ts';
import { AuthFlow, throttle } from './throttle.ts';

// better-auth's own endpoints, served as GraphQL by @cubicecho/graphql-better-auth: the last leg of an OIDC
// sign-in, and a person's sessions. Fields and types come from the auth config, so an upgrade moves them with it.

/** The better-auth endpoints served, by name. */
export const BETTER_AUTH_OPERATIONS = [
  'verifyOneTimeToken',
  'getSession',
  'listSessions',
  'signOut',
  'revokeSession',
  'revokeSessions',
  'revokeOtherSessions',
];

/** The address the describing instance is built with. Never served: every call goes to the request's own instance. */
const DESCRIBING_URL = 'http://localhost';

/** What a one-time token that cannot be spent is told: the sign-in has to be started again. */
const BAD_SSO_TOKEN = 'Invalid or expired sign-in. Sign in again.';

/** What an API key reaching for a person's sessions is told. */
const SESSION_ONLY = 'Only a person signed in to the router can do this. An API key cannot.';

/** A session as the UI keeps it: the bearer token, and whose it is. */
const SESSION_RESULT: JsonSchema = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'The session, to send as `Authorization: Bearer <token>`.' },
    userId: { type: 'string', format: 'uuid', description: "The session's user." },
  },
  required: ['token', 'userId'],
};

/** What better-auth answers a spent one-time token with, as far as this reads it. */
interface VerifiedToken {
  session: { token: string };
  user: { id: string };
}

/**
 * Whether a value is what better-auth answers a spent one-time token with.
 *
 * @param value - The answer.
 * @returns true when it carries a session token and a user id.
 */
function isVerifiedToken(value: unknown): value is VerifiedToken {
  if (typeof value === 'object' && value !== null && 'session' in value && 'user' in value) {
    const { session, user } = value;
    const hasToken = typeof session === 'object' && session !== null && 'token' in session;
    const hasUser = typeof user === 'object' && user !== null && 'id' in user;
    return hasToken && hasUser;
  }
  return false;
}

/**
 * The last leg of an OIDC sign-in: the UI's /auth/sso page spends the one-time token http/sso.ts put on its URL.
 * Answers with the session's bearer token and user, never UNAUTHENTICATED, which would sign the UI out.
 */
const verifyOneTimeToken: OperationOptions<Context> = {
  result: () => SESSION_RESULT,
  around: (call, next) =>
    throttle(call.context, AuthFlow.VerifyOneTimeToken, async () => {
      let result: unknown;
      try {
        result = await next();
      } catch (error) {
        throw error instanceof GraphQLError ? codedError(ErrorCode.BadUserInput, BAD_SSO_TOKEN) : error;
      }
      if (isVerifiedToken(result) === false) {
        throw codedError(ErrorCode.BadUserInput, BAD_SSO_TOKEN);
      }
      return { token: result.session.token, userId: result.user.id };
    }),
};

/** Ends the caller's session. Signing out with none is `success: false`, not an error. */
const signOut: OperationOptions<Context> = {
  omitArgs: ['callbackURL', 'disableRedirect', 'state'],
  around: async (call, next) => {
    if ((await sessionUser(call.context.auth, call.context.headers)) === null) {
      return { success: false };
    }
    return next();
  },
};

/**
 * Adds better-auth's endpoints to the schema. Each call goes to the request's own auth instance with the
 * request's headers, which is where better-auth finds the session.
 *
 * @param schema - The schema so far.
 * @param db - The database the describing instance is built over.
 * @returns The schema with them.
 */
export function applyBetterAuthExtension(schema: GraphQLSchema, db: DB): GraphQLSchema {
  // Described with no OIDC provider, whose discovery document describing would fetch.
  const describing = createAuth(db, { baseUrl: DESCRIBING_URL, oidc: null });
  const built = betterAuthGraphQL<Context>(describing, {
    include: BETTER_AUTH_OPERATIONS,
    auth: (context) => context.auth,
    headers: (context) => context.headers,
    before: ({ context }) => {
      if (context.caller === CALLER_AGENT) {
        throw codedError(ErrorCode.Forbidden, SESSION_ONLY);
      }
    },
    operations: { verifyOneTimeToken, signOut },
  });
  return applyBetterAuthGraphQL(schema, built);
}
