import type { ServerOAuth } from '@mcp-router/shared';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { isHttpsUrl } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  type OAuthClientInformationMixed,
  OAuthClientInformationSchema,
  type OAuthClientMetadata,
  type OAuthTokens,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAUTH_DEFAULTS } from '../core/defaults.ts';

/** A sign-in started from the UI and waiting for the login to send the browser back. */
export interface PendingFlow {
  /** The OAuth `state`: the key the callback is matched by, and its CSRF check. */
  state: string;
  serverName: string;
  /** The router's address for this sign-in: `publicUrl`, else the UI's origin. */
  base: string;
  /** The UI's origin; the sign-in window posts its result there. */
  uiOrigin: string;
  /** `Date.now()` at start; the flow expires `OAUTH_DEFAULTS.flowTtlMs` after it. */
  createdAt: number;
  /** The PKCE verifier, set when the SDK builds the authorization URL. */
  verifier?: string;
  /** The login page, captured from `redirectToAuthorization` for the UI to open. */
  authorizationUrl?: string;
}

/** What a provider reads and writes; the service implements it over the config store. */
export interface OAuthBackend {
  /** The server's stored sign-in, as last saved. */
  read(serverName: string): ServerOAuth | undefined;
  /** Replaces the server's stored sign-in with what `mutate` makes of it. */
  write(serverName: string, mutate: (current: ServerOAuth) => ServerOAuth): Promise<void>;
  /** Discovery results, kept in memory only: they are cheap to redo and not worth a config write. */
  discovery(serverName: string): OAuthDiscoveryState | undefined;
  saveDiscovery(serverName: string, state: OAuthDiscoveryState | undefined): void;
  /** Notes that the server asked for a login nobody can do from here. */
  markNeedsSignIn(serverName: string): void;
}

/** Thrown into the SDK when a background connect would need a login; the connect fails with it. */
export class NeedsSignInError extends Error {
  constructor(serverName: string) {
    super(`Server "${serverName}" needs you to sign in`);
    this.name = 'NeedsSignInError';
  }
}

/**
 * The router's redirect URI under an address.
 *
 * @param base - `publicUrl` or the UI's origin, with or without a trailing slash.
 * @returns `<base>/oauth/callback`.
 */
export function callbackUrl(base: string): string {
  return new URL(OAUTH_DEFAULTS.callbackPath, base).toString();
}

/**
 * The router's client metadata document URL under an address, which is also its client id at a login that takes one.
 *
 * @param base - `publicUrl` or the UI's origin.
 * @returns `<base>/oauth/client-metadata.json`.
 */
export function clientMetadataUrl(base: string): string {
  return new URL(OAUTH_DEFAULTS.clientMetadataPath, base).toString();
}

/**
 * The client metadata the router registers with, and serves at its metadata URL.
 *
 * @param redirectUri - Its one redirect URI.
 * @param [options.scope] - Scopes to ask for when the server names none.
 * @param [options.confidential] - Whether it authenticates with a client secret.
 * @returns RFC 7591 client metadata.
 */
export function routerClientMetadata(
  redirectUri: string,
  options: { scope?: string; confidential?: boolean } = {},
): OAuthClientMetadata {
  return {
    client_name: OAUTH_DEFAULTS.clientName,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: options.confidential ? 'client_secret_post' : 'none',
    ...(options.scope ? { scope: options.scope } : {}),
  };
}

/**
 * The SDK's `OAuthClientProvider` for one remote server, over its stored sign-in.
 *
 * @remarks
 * Two modes. **With a flow** it is the interactive half: the UI asked to sign in, so registering a client, building
 * the authorization URL and exchanging the code all happen against that flow's redirect URI. **Without one** it is
 * what the pool's transport holds for every remote: it hands out the stored token and lets the SDK refresh it, and
 * when that is not enough it marks the server as needing a sign-in rather than registering clients or starting logins
 * nobody will finish.
 *
 * It holds no tokens itself: every read goes to the store, so any number of these for one server agree, and one held
 * by a long-lived transport sees a sign-in done after it was made.
 */
export class StoredOAuthProvider implements OAuthClientProvider {
  private readonly backend: OAuthBackend;
  private readonly serverName: string;
  private readonly flow?: PendingFlow;

  /**
   * @param backend - Where the sign-in is stored.
   * @param serverName - The base server's name; a workspace instance signs in as its server.
   * @param [flow] - The interactive sign-in this provider serves, when there is one.
   */
  constructor(backend: OAuthBackend, serverName: string, flow?: PendingFlow) {
    this.backend = backend;
    this.serverName = serverName;
    this.flow = flow;
  }

  private stored(): ServerOAuth {
    return this.backend.read(this.serverName) ?? {};
  }

  get redirectUrl(): string | undefined {
    return this.flow ? callbackUrl(this.flow.base) : this.stored().redirectUri;
  }

  /**
   * Offered only over HTTPS during a sign-in: the SDK refuses any other URL here, even for a login that would not use
   * it. A plain-HTTP router on a LAN is handled in `clientInformation` instead.
   */
  get clientMetadataUrl(): string | undefined {
    if (!this.flow) {
      return undefined;
    }
    const url = clientMetadataUrl(this.flow.base);
    return isHttpsUrl(url) ? url : undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    const { scope, clientSecret } = this.stored();
    return routerClientMetadata(this.redirectUrl ?? '', { scope, confidential: clientSecret !== undefined });
  }

  state(): string {
    return this.flow?.state ?? '';
  }

  /**
   * The client to sign in as.
   *
   * @remarks
   * A typed-in client wins. A stored one is used only with the redirect URI it was set up with: a sign-in from another
   * address needs a client that accepts that address. With none and no flow, the connect is failed with
   * {@link NeedsSignInError} before the SDK registers anything. With a flow against a login that takes metadata URLs as
   * ids (Home Assistant), the URL is used directly even over plain HTTP, which the SDK would refuse to do itself; the
   * redirect URI shares its origin, which is what such a login checks.
   */
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const stored = this.stored();
    if (stored.clientId) {
      return { client_id: stored.clientId, ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}) };
    }
    const redirect = this.redirectUrl;
    if (stored.clientInformation && stored.redirectUri === redirect) {
      const parsed = OAuthClientInformationSchema.safeParse(stored.clientInformation);
      if (parsed.success) {
        return parsed.data;
      }
    }
    if (!this.flow) {
      this.backend.markNeedsSignIn(this.serverName);
      throw new NeedsSignInError(this.serverName);
    }
    const metadataUrl = clientMetadataUrl(this.flow.base);
    const takesMetadataUrls =
      this.backend.discovery(this.serverName)?.authorizationServerMetadata?.client_id_metadata_document_supported ===
      true;
    if (takesMetadataUrls && isHttpsUrl(metadataUrl) === false) {
      const info = { client_id: metadataUrl };
      await this.saveClientInformation(info);
      return info;
    }
    return undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const redirectUri = this.redirectUrl;
    await this.backend.write(this.serverName, (current) => ({
      ...current,
      clientInformation: { ...info },
      redirectUri,
    }));
  }

  tokens(): OAuthTokens | undefined {
    const { tokens } = this.stored();
    if (!tokens) {
      return undefined;
    }
    const parsed = OAuthTokensSchema.safeParse(tokens);
    return parsed.success ? parsed.data : undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const redirectUri = this.redirectUrl;
    await this.backend.write(this.serverName, (current) => ({
      ...current,
      // A refresh may leave the refresh token out, meaning "keep using the one you have".
      tokens: { ...tokens, refresh_token: tokens.refresh_token ?? current.tokens?.refresh_token },
      tokensSavedAt: new Date().toISOString(),
      redirectUri,
    }));
  }

  /** Captures the login URL for the UI; in the background there is nobody to send there, so it marks the server. */
  redirectToAuthorization(authorizationUrl: URL): void {
    if (this.flow) {
      this.flow.authorizationUrl = authorizationUrl.toString();
      return;
    }
    this.backend.markNeedsSignIn(this.serverName);
  }

  saveCodeVerifier(verifier: string): void {
    if (this.flow) {
      this.flow.verifier = verifier;
    }
  }

  codeVerifier(): string {
    if (!this.flow?.verifier) {
      throw new Error(`No sign-in is in progress for server "${this.serverName}"`);
    }
    return this.flow.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.backend.saveDiscovery(this.serverName, state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.backend.discovery(this.serverName);
  }

  /** Forgets what the server's login rejected, so the next attempt starts over from that point. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier') {
      if (this.flow) {
        this.flow.verifier = undefined;
      }
      return;
    }
    if (scope === 'all' || scope === 'discovery') {
      this.backend.saveDiscovery(this.serverName, undefined);
    }
    if (scope === 'discovery') {
      return;
    }
    await this.backend.write(this.serverName, (current) => {
      const next = { ...current };
      if (scope === 'all' || scope === 'client') {
        delete next.clientInformation;
      }
      delete next.tokens;
      delete next.tokensSavedAt;
      return next;
    });
  }
}
