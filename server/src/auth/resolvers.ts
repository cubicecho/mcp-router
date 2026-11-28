import { createApiKeyRequestSchema } from '@mcp-router/shared';
import { GraphQLDateTime, GraphQLUUID } from '@vantreeseba/drizzle-graphql';
import { eq } from 'drizzle-orm';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  type GraphQLFieldConfigMap,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLNullableType,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { secureLocalNet } from '../config/env.ts';
import type { Context } from '../core/context.ts';
import { forbidden, notFound, unauthenticated } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { Role, users } from '../db/tables/users.ts';
import { handField } from '../graphql/hand-field.ts';
import { SSO_START_PATH } from '../http/sso.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { type ApiKeySummary, createKey, listKeys, revokeKey } from './keys.ts';
import { AuthFlow, throttle } from './throttle.ts';
import { signInLocalAdmin } from './trusted-network.ts';

// Signing in to the UI, the signed-in person, and the API keys machine callers use. better-auth's own endpoints (the
// last leg of an OIDC sign-in, sessions, signing out) are served beside these by endpoints.ts.

/** What a sign-in on an untrusted network is told. */
const NOT_TRUSTED = 'This router is not on a trusted network (SECURE_LOCAL_NET). Sign in with its OIDC provider.';

/**
 * Wraps a type as non-null.
 *
 * @typeParam T - The type.
 * @param type - The type.
 * @returns `type!`.
 */
const required = <T extends GraphQLNullableType>(type: T) => new GraphQLNonNull(type);

const SsoProviderType = new GraphQLObjectType({
  name: 'SsoProvider',
  description: 'An OpenID Connect provider the sign-in page offers.',
  fields: {
    name: { type: required(GraphQLString), description: 'What the button calls it (OIDC_NAME, or the setup URL).' },
    signInUrl: {
      type: required(GraphQLString),
      description: 'Where the button sends the browser: a full-page navigation, not a fetch.',
    },
  },
});

const AuthConfigType = new GraphQLObjectType({
  name: 'AuthConfig',
  description: 'How people sign in to this router, so the sign-in page offers only that.',
  fields: {
    trustedNetwork: {
      type: required(GraphQLBoolean),
      description: 'Whoever opens the UI is signed in as the local admin (SECURE_LOCAL_NET). Private networks only.',
    },
    sso: {
      type: SsoProviderType,
      description: 'The OIDC provider to sign in with (OIDC_ISSUER, or the paired one), or null when there is none.',
    },
  },
});

const IssuedSessionType = new GraphQLObjectType({
  name: 'IssuedSession',
  description: 'A session, as the UI keeps it.',
  fields: {
    token: { type: required(GraphQLString), description: 'Sent back as `Authorization: Bearer`.' },
    userId: { type: new GraphQLNonNull(GraphQLUUID) },
  },
});

const RoleType = new GraphQLEnumType({
  name: 'UsersRoleEnum',
  description: 'What a signed-in person may do. Only an admin may pair or disconnect the OIDC provider.',
  values: { admin: { value: Role.Admin }, user: { value: Role.User } },
});

const UserType = new GraphQLObjectType({
  name: 'User',
  description: "A person who signs in to the router's UI.",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLUUID) },
    email: { type: required(GraphQLString) },
    name: { type: GraphQLString },
    emailVerified: {
      type: required(GraphQLBoolean),
      description: 'Whether the OIDC provider vouched for the address.',
    },
    image: { type: GraphQLString },
    role: { type: required(RoleType), description: 'The first person to sign in is made an admin.' },
    createdAt: { type: required(GraphQLDateTime) },
    updatedAt: { type: required(GraphQLDateTime) },
  },
});

const ApiKeyType = new GraphQLObjectType<ApiKeySummary>({
  name: 'ApiKey',
  description: 'A key a machine caller sends as `x-api-key` or `Authorization: Bearer`. Never the key itself.',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLUUID) },
    name: {
      type: required(GraphQLString),
      description:
        'What the operator called it. A key carried over from the old router token is "Imported router token".',
    },
    start: { type: GraphQLString, description: "The key's first characters, to tell keys apart." },
    createdAt: { type: required(GraphQLDateTime) },
    lastUsedAt: { type: GraphQLDateTime, description: 'When the key last authenticated a request.' },
    expiresAt: { type: GraphQLDateTime, description: 'Null for a key that never expires.' },
  },
});

const CreatedApiKeyType = new GraphQLObjectType({
  name: 'CreatedApiKey',
  description: 'A key just made. `key` is shown this once: only its hash is kept.',
  fields: {
    key: {
      type: required(GraphQLString),
      description: 'The whole key, to send as `x-api-key: <key>` or `Authorization: Bearer <key>`.',
    },
    apiKey: { type: required(ApiKeyType) },
  },
});

/** The arguments of `createApiKey`. */
interface CreateArgs {
  name: string;
  expiresInDays?: number | null;
}

/** The arguments of `revokeApiKey`. */
interface RevokeArgs {
  id: string;
}

/**
 * Reads the signed-in person a resolver acts for.
 *
 * @param ctx - The request.
 * @returns Their user id.
 * @throws UNAUTHENTICATED for nobody, FORBIDDEN for an API key. Permissions refuse both first; this is what lets the
 * resolver's types know who it acts for.
 */
function requireOperator(ctx: Context): string {
  if (ctx.caller === null) {
    throw unauthenticated('Sign in first.');
  }
  if (ctx.userId === null || ctx.keyId !== null) {
    throw forbidden('Only a person signed in to the router can do this. An API key cannot.');
  }
  return ctx.userId;
}

/**
 * The sign-in queries: how to sign in, and who is signed in.
 *
 * @returns The fields, for the Query root.
 */
export function authQueries(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    authConfig: handField<Record<string, never>>({
      type: required(AuthConfigType),
      description: 'How people sign in to this router. Readable signed out, for the sign-in page.',
      resolve: async (_args, ctx) => {
        const { config: oidc } = await effectiveOidc(ctx.db);
        const signInUrl = `${ctx.authHost.baseUrl()}${SSO_START_PATH}`;
        return { trustedNetwork: secureLocalNet(), sso: oidc === null ? null : { name: oidc.name, signInUrl } };
      },
    }),
    me: handField<Record<string, never>>({
      type: required(UserType),
      description: 'The signed-in user, with their role.',
      resolve: async (_args, ctx) => {
        const userId = requireOperator(ctx);
        const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
        if (user === undefined) {
          throw notFound('The signed-in user no longer exists.');
        }
        return user;
      },
    }),
    apiKeys: handField<Record<string, never>>({
      type: required(new GraphQLList(required(ApiKeyType))),
      description: 'Every API key, newest first. Never the keys themselves.',
      resolve: (_args, ctx) => listKeys(ctx.db),
    }),
  };
}

/**
 * The sign-in and key mutations.
 *
 * @returns The fields, for the Mutation root.
 */
export function authMutations(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    signInOnTrustedNetwork: handField<Record<string, never>>({
      type: required(IssuedSessionType),
      description:
        'On a trusted network (SECURE_LOCAL_NET), signs whoever opened the UI in as the local admin. FORBIDDEN anywhere else.',
      resolve: (_args, ctx) =>
        throttle(ctx, AuthFlow.TrustedNetwork, async () => {
          if (secureLocalNet() === false) {
            throw forbidden(NOT_TRUSTED);
          }
          return signInLocalAdmin(ctx.db, ctx.auth);
        }),
    }),
    createApiKey: handField<CreateArgs>({
      type: required(CreatedApiKeyType),
      description: 'Makes an API key for an agent or MCP client. Its `key` is shown this once. Only from a session.',
      args: {
        name: { type: required(GraphQLString), description: 'What to call it: the agent or client that will hold it.' },
        expiresInDays: { type: GraphQLInt, description: 'Days until it stops working. Left out, it never expires.' },
      },
      resolve: async (args, ctx) => {
        const userId = requireOperator(ctx);
        const input = parseOrThrow(createApiKeyRequestSchema, args, 'API key');
        return createKey(ctx.db, ctx.auth, { userId, ...input });
      },
    }),
    revokeApiKey: handField<RevokeArgs>({
      type: required(GraphQLBoolean),
      description: 'Revokes an API key: it stops working on its next request. Only from a session.',
      args: { id: { type: new GraphQLNonNull(GraphQLUUID) } },
      resolve: async (args, ctx) => {
        requireOperator(ctx);
        await revokeKey(ctx.db, args.id);
        return true;
      },
    }),
  };
}
