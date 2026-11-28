import { ErrorCode } from '@mcp-router/shared';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLError,
  type GraphQLFieldConfigMap,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { hasUsers } from '../auth/admin.ts';
import { oidcRedirectUri } from '../config/env.ts';
import { CALLER_OPERATOR, type Context } from '../core/context.ts';
import { badInput, conflict, forbidden } from '../core/errors.ts';
import { Role } from '../db/tables/users.ts';
import { handField } from '../graphql/hand-field.ts';
import { PairingError, PairingFailure, pair, unpair } from './pairing.ts';
import { effectiveOidc, SsoSource } from './settings.ts';

// Pairing the router with an OIDC provider from the UI (pairing.ts): paste the setup URL the provider gave you, and
// its button appears on the login page without a restart.
//
// Who may pair: the admin, or anyone at all while the router is brand new (no accounts yet), so whoever installs the
// router can set sign-in up from the login page before there is an admin to ask. The first account to be created
// becomes the admin (auth/admin.ts). Once anyone has an account, a stranger could otherwise point sign-in at a
// provider of their own and sign in as any existing address, so only the admin may.
//
// A provider set in the environment (OIDC_ISSUER) wins, and cannot be changed from here.

const SsoSourceType = new GraphQLEnumType({
  name: 'SsoSource',
  description: "Where the router's OIDC provider comes from.",
  values: {
    ENV: { value: SsoSource.Env, description: "OIDC_ISSUER in the server's environment. Read-only from the UI." },
    PAIRED: { value: SsoSource.Paired, description: 'Paired from a setup URL.' },
    NONE: { value: SsoSource.None, description: 'There is none.' },
  },
});

const SsoSetupType = new GraphQLObjectType({
  name: 'SsoSetup',
  description: 'How sign-in through an OIDC provider is set up, and whether the caller may change it.',
  fields: {
    source: { type: new GraphQLNonNull(SsoSourceType) },
    issuer: { type: GraphQLString, description: "The provider's issuer URL. Only for a caller who may pair." },
    name: { type: GraphQLString, description: "What the login page's button calls the provider." },
    canPair: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: 'Whether the caller may pair a provider, or disconnect the paired one.',
    },
    redirectUri: {
      type: new GraphQLNonNull(GraphQLString),
      description: 'The redirect URI to register with a provider by hand, for an OIDC_ISSUER setup.',
    },
  },
});

/** The arguments of `pairSso`. */
interface PairArgs {
  setupUrl: string;
}

/**
 * Whether the caller may pair or disconnect a provider.
 *
 * @param ctx - The request.
 * @param source - Where the provider in use comes from.
 * @returns False for a provider from the environment; otherwise true for the admin, or for anyone while there are
 * no accounts.
 */
export async function canPairSso(ctx: Context, source: SsoSource): Promise<boolean> {
  if (source === SsoSource.Env) {
    return false;
  }
  const isAdminCaller = ctx.caller === CALLER_OPERATOR && ctx.role === Role.Admin;
  if (isAdminCaller) {
    return true;
  }
  return (await hasUsers(ctx.db)) === false;
}

/**
 * Answers `ssoSetup` for the caller.
 *
 * @param ctx - The request.
 * @returns How sign-in is set up, with the issuer only for a caller who may pair.
 */
async function ssoSetup(ctx: Context) {
  const { config, source } = await effectiveOidc(ctx.db);
  const canPair = await canPairSso(ctx, source);
  return {
    source,
    issuer: canPair ? (config?.issuer ?? null) : null,
    name: config?.name ?? null,
    canPair,
    redirectUri: oidcRedirectUri(ctx.authHost.baseUrl()),
  };
}

/**
 * Refuses a caller who may not pair.
 *
 * @param ctx - The request.
 * @returns Where the provider in use comes from.
 * @throws FORBIDDEN, saying where it can be changed instead. This is about the router, not a row, so it is not the
 * NOT_FOUND a row would be.
 */
async function requirePairing(ctx: Context): Promise<SsoSource> {
  const { source } = await effectiveOidc(ctx.db);
  if (source === SsoSource.Env) {
    throw forbidden("Sign-in is set by OIDC_ISSUER in the server's environment. Change it there.");
  }
  if ((await canPairSso(ctx, source)) === false) {
    throw forbidden('Only the admin can change how people sign in.');
  }
  return source;
}

/**
 * Turns a pairing failure into an API error that carries its reason for the UI.
 *
 * @param error - What pairing threw.
 * @returns The API error, or `error` itself when it is not a pairing failure.
 */
function pairingError(error: unknown): unknown {
  if (error instanceof PairingError === false) {
    return error;
  }
  const code = error.reason === PairingFailure.RateLimited ? ErrorCode.TooManyRequests : ErrorCode.BadUserInput;
  return new GraphQLError(error.message, { extensions: { code, reason: error.reason } });
}

/**
 * The SSO setup query.
 *
 * @returns The fields, for the Query root.
 */
export function ssoQueries(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    ssoSetup: handField<Record<string, never>>({
      type: new GraphQLNonNull(SsoSetupType),
      description:
        'How OIDC sign-in is set up. Readable signed out, so a new router can be paired from its login page.',
      resolve: (_args, ctx) => ssoSetup(ctx),
    }),
  };
}

/**
 * The pairing mutations.
 *
 * @returns The fields, for the Mutation root.
 */
export function ssoMutations(): GraphQLFieldConfigMap<unknown, Context> {
  return {
    pairSso: handField<PairArgs>({
      type: new GraphQLNonNull(SsoSetupType),
      description:
        'Pairs with the provider a setup URL names (`<issuer>#setup=<token>&name=<name>`). The admin, or anyone on a ' +
        'router with no accounts. BAD_USER_INPUT or TOO_MANY_REQUESTS with `extensions.reason` when the provider would not pair.',
      args: { setupUrl: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (args, ctx) => {
        const source = await requirePairing(ctx);
        if (source === SsoSource.Paired) {
          throw conflict('The router is already paired with a provider. Disconnect it first.');
        }
        if (args.setupUrl.trim() === '') {
          throw badInput('Paste the setup URL your provider gave you.');
        }
        try {
          await pair(ctx.db, args.setupUrl, oidcRedirectUri(ctx.authHost.baseUrl()));
        } catch (error) {
          throw pairingError(error);
        }
        await ctx.authHost.rebuild();
        return ssoSetup(ctx);
      },
    }),
    unpairSso: handField<Record<string, never>>({
      type: new GraphQLNonNull(SsoSetupType),
      description:
        "Deletes the paired provider's client and stops offering it on the login page. Same rule as pairSso.",
      resolve: async (_args, ctx) => {
        await requirePairing(ctx);
        await unpair(ctx.db);
        await ctx.authHost.rebuild();
        return ssoSetup(ctx);
      },
    }),
  };
}
