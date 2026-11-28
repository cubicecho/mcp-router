import type { OidcConfig } from '../config/env.ts';
import type { DB } from '../db/client.ts';
import { effectiveOidc } from '../sso/settings.ts';
import { type Auth, type AuthOptions, createAuth } from './better-auth.ts';

// better-auth fixes its plugins and its address when it is created, and the OIDC provider is a plugin. Pairing a
// provider, or changing the router's `publicUrl`, while the router runs therefore means a new instance, so every
// request asks this host. Sessions and keys are rows in Postgres, so a rebuild signs nobody out.

/** Where the current auth instance is. */
export interface AuthHost {
  /** The auth instance to use for this request. */
  current(): Auth;
  /** The OIDC provider `current()` was built with, or null. */
  oidc(): OidcConfig | null;
  /** The router's address `current()` was built with. */
  baseUrl(): string;
  /** Builds a new instance from the provider and the address in use now. */
  rebuild(): Promise<void>;
}

/** What a host builds each instance with. */
export interface AuthHostOptions extends Omit<AuthOptions, 'oidc' | 'baseUrl'> {
  /** Reads the router's address (`routerUrl`) at each build. */
  baseUrl: () => string;
}

/**
 * Builds a host from the environment and the database's pairing.
 *
 * @param db - The database. Migrations must have run: the pairing is read from it.
 * @param options - Where the router's address comes from, and test overrides. `oidc` is the host's to decide.
 * @returns The host, with its first instance built.
 */
export async function createAuthHost(db: DB, { baseUrl, ...rest }: AuthHostOptions): Promise<AuthHost> {
  const build = async () => {
    const { config } = await effectiveOidc(db);
    const url = baseUrl();
    return { auth: createAuth(db, { ...rest, baseUrl: url, oidc: config }), oidc: config, url };
  };
  let built = await build();
  return {
    current: () => built.auth,
    oidc: () => built.oidc,
    baseUrl: () => built.url,
    async rebuild() {
      built = await build();
    },
  };
}

/**
 * Builds a host that never changes, for a caller that already has its instance.
 *
 * @param auth - The instance.
 * @param baseUrl - The address it was built with.
 * @param [oidc] - The provider it was built with.
 * @param [rebuild] - What to do when asked to rebuild.
 * @returns The host.
 */
export function fixedAuthHost(
  auth: Auth,
  baseUrl: string,
  oidc: OidcConfig | null = null,
  rebuild = async () => {},
): AuthHost {
  return { current: () => auth, oidc: () => oidc, baseUrl: () => baseUrl, rebuild };
}
