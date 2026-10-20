import { randomBytes } from 'node:crypto';
import {
  HttpStatus,
  MS_PER_SECOND,
  type OAuthClientRequest,
  type ServerConfig,
  type ServerOAuth,
  type ServerOAuthStatus,
  TRANSPORT_STREAMABLE_HTTP,
} from '@mcp-router/shared';
import {
  auth,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { ConfigStore } from '../config/store.ts';
import { OAUTH_DEFAULTS } from '../core/defaults.ts';
import { badInput, errorMessage, upstreamFailed } from '../core/errors.ts';
import { SERVER_VERSION } from '../core/version.ts';
import { type OAuthBackend, type PendingFlow, StoredOAuthProvider } from './provider.ts';

/** What the gateway asks about a remote server's sign-in. */
export interface RemoteAuth {
  /** The provider a server's transport signs its requests with. */
  providerFor(serverName: string): OAuthClientProvider;
  /** Whether the server's last connect stopped at a login. */
  requiresSignIn(serverName: string): boolean;
  /** The sign-in as the API reports it, without tokens; undefined for a stdio server. */
  status(config: ServerConfig): ServerOAuthStatus | undefined;
}

/** What the server's login answered at the end of a sign-in. */
export interface FinishedFlow {
  serverName: string;
  /** The UI's origin, which the callback page reports to. */
  uiOrigin: string;
}

/** Options for {@link OAuthService}. */
export interface OAuthServiceOptions {
  /** Called after a sign-in or sign-out, so the server's connections are dialled again. */
  onChange?: (serverName: string) => Promise<void>;
  /** What the sign-in's own requests (discovery, registration, token exchange) are made with. */
  fetch?: FetchLike;
}

/**
 * Sets, replaces or removes a remote server's pre-registered client.
 *
 * @param current - The stored sign-in.
 * @param request - The client; `null` removes it, and an omitted `clientSecret` keeps the stored one.
 * @returns The new sign-in, or undefined when nothing is left in it. A changed client drops the tokens and the
 * registered client, since both belong to the old one.
 */
export function applyOAuthClient(
  current: ServerOAuth | undefined,
  request: OAuthClientRequest | null,
): ServerOAuth | undefined {
  const { clientId, clientSecret, scope, ...rest } = current ?? {};
  let next: ServerOAuth = rest;
  if (request) {
    const secret = request.clientSecret === undefined ? clientSecret : request.clientSecret || undefined;
    next = {
      ...rest,
      clientId: request.clientId,
      ...(secret ? { clientSecret: secret } : {}),
      ...(request.scope ? { scope: request.scope } : {}),
    };
  }
  const changed = clientId !== next.clientId || clientSecret !== next.clientSecret || scope !== next.scope;
  if (changed) {
    delete next.tokens;
    delete next.tokensSavedAt;
    delete next.clientInformation;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Drops a remote server's sign-in when its URL moves to another origin.
 *
 * @param previous - The config in force.
 * @param next - The config about to replace it.
 * @returns `next`, without the tokens and registered client when they were issued for a different origin.
 *
 * @remarks
 * A token is the old server's: sending it to whatever the URL now points at would hand it to a stranger.
 */
export function dropSignInOnMove(previous: ServerConfig, next: ServerConfig): ServerConfig {
  if (
    previous.transport.type !== TRANSPORT_STREAMABLE_HTTP ||
    next.transport.type !== TRANSPORT_STREAMABLE_HTTP ||
    !next.oauth ||
    new URL(previous.transport.url).origin === new URL(next.transport.url).origin
  ) {
    return next;
  }
  const { tokens: _tokens, tokensSavedAt: _savedAt, clientInformation: _client, redirectUri: _r, ...kept } = next.oauth;
  return { ...next, oauth: Object.keys(kept).length > 0 ? kept : undefined };
}

/**
 * OAuth sign-in for remote servers: the interactive flow the UI drives, and the store the transports' providers read.
 *
 * @remarks
 * Tokens and registered clients are kept in the server's config file (plaintext, 0600, like `env`). What only lasts a
 * sign-in — the PKCE verifier, the `state` — and what is cheap to redo — discovery — stays in memory.
 */
export class OAuthService implements OAuthBackend, RemoteAuth {
  private readonly store: ConfigStore;
  private readonly fetchFn: FetchLike;
  private onChange: (serverName: string) => Promise<void>;
  private readonly pending = new Map<string, PendingFlow>();
  private readonly discoveryByServer = new Map<string, OAuthDiscoveryState>();
  private readonly needsSignIn = new Set<string>();
  /** One write at a time per server, so a refresh racing a sign-out cannot interleave read-modify-writes. */
  private readonly writes = new Map<string, Promise<void>>();

  constructor(store: ConfigStore, options: OAuthServiceOptions = {}) {
    this.store = store;
    this.fetchFn = options.fetch ?? fetch;
    this.onChange = options.onChange ?? (async () => {});
  }

  /** Sets what runs after a sign-in or sign-out; the gateway is built after this service. */
  setOnChange(onChange: (serverName: string) => Promise<void>): void {
    this.onChange = onChange;
  }

  read(serverName: string): ServerOAuth | undefined {
    return this.store.getServer(serverName)?.oauth;
  }

  write(serverName: string, mutate: (current: ServerOAuth) => ServerOAuth): Promise<void> {
    const previous = this.writes.get(serverName) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const config = this.store.getServer(serverName);
        if (!config) {
          return; // deleted while a refresh was in flight
        }
        const oauth = mutate(config.oauth ?? {});
        await this.store.saveServer({ ...config, oauth: Object.keys(oauth).length > 0 ? oauth : undefined });
        if (oauth.tokens) {
          this.needsSignIn.delete(serverName);
        }
      });
    this.writes.set(serverName, next);
    return next;
  }

  discovery(serverName: string): OAuthDiscoveryState | undefined {
    return this.discoveryByServer.get(serverName);
  }

  saveDiscovery(serverName: string, state: OAuthDiscoveryState | undefined): void {
    if (state) {
      this.discoveryByServer.set(serverName, state);
    } else {
      this.discoveryByServer.delete(serverName);
    }
  }

  markNeedsSignIn(serverName: string): void {
    this.needsSignIn.add(serverName);
  }

  providerFor(serverName: string): OAuthClientProvider {
    return new StoredOAuthProvider(this, serverName);
  }

  requiresSignIn(serverName: string): boolean {
    return this.needsSignIn.has(serverName);
  }

  status(config: ServerConfig): ServerOAuthStatus | undefined {
    if (config.transport.type !== TRANSPORT_STREAMABLE_HTTP) {
      return undefined;
    }
    // The store's copy rather than the caller's: the gateway's is only as new as its last reconcile, and a sign-in
    // writes the store first.
    const oauth = this.store.getServer(config.name)?.oauth ?? config.oauth ?? {};
    const tokens = oauth.tokens ?? {};
    const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : undefined;
    const savedAt = oauth.tokensSavedAt ? Date.parse(oauth.tokensSavedAt) : Number.NaN;
    return {
      signedIn: typeof tokens.access_token === 'string',
      ...(expiresIn !== undefined && Number.isFinite(savedAt)
        ? { expiresAt: new Date(savedAt + expiresIn * MS_PER_SECOND).toISOString() }
        : {}),
      refreshable: typeof tokens.refresh_token === 'string',
      ...(oauth.clientId ? { clientId: oauth.clientId } : {}),
      hasClientSecret: oauth.clientSecret !== undefined,
    };
  }

  /**
   * Starts a sign-in: asks the server what login it wants, and builds the URL of that login's page.
   *
   * @param serverName - A streamable-http server.
   * @param uiOrigin - The UI's origin; the router's address too, when settings.json has no `publicUrl`.
   * @returns The login page to open, or `signedIn` when the stored sign-in turned out to still work.
   * Throws a 400 for a stdio server or one that does not ask for a login, and a 502 when its login cannot be reached.
   */
  async start(serverName: string, uiOrigin: string): Promise<{ authorizationUrl?: string; signedIn: boolean }> {
    const url = this.remoteUrl(serverName);
    const challenge = await this.challenge(serverName, url);
    this.prune();
    const flow: PendingFlow = {
      state: randomBytes(OAUTH_DEFAULTS.stateBytes).toString('base64url'),
      serverName,
      base: this.store.getSettings().publicUrl ?? uiOrigin,
      uiOrigin,
      createdAt: Date.now(),
    };
    this.pending.set(flow.state, flow);
    let result: Awaited<ReturnType<typeof auth>>;
    try {
      result = await auth(new StoredOAuthProvider(this, serverName, flow), {
        serverUrl: url,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
        scope: challenge.scope,
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      this.pending.delete(flow.state);
      throw upstreamFailed(`Could not start the sign-in for server "${serverName}"`, errorMessage(cause), { cause });
    }
    if (result === 'AUTHORIZED') {
      this.pending.delete(flow.state);
      this.needsSignIn.delete(serverName);
      await this.onChange(serverName);
      return { signedIn: true };
    }
    return { signedIn: false, authorizationUrl: flow.authorizationUrl };
  }

  /**
   * Asks a remote server, without a token, whether it wants a sign-in, and records the answer for its status.
   *
   * @param serverName - The server.
   * @returns True when it answered 401 and the router holds no tokens for it. False for a stdio server, one that let
   * the request through, or one that could not be reached within `OAUTH_DEFAULTS.checkTimeoutMs` — a check is advice,
   * and the connect that follows reports the real failure.
   *
   * @remarks
   * What the UI calls straight after adding a server, so a login-gated one says "Sign in" at once rather than on the
   * first request that wakes it.
   */
  async check(serverName: string): Promise<boolean> {
    const config = this.store.getServer(serverName);
    if (config?.transport.type !== TRANSPORT_STREAMABLE_HTTP) {
      return false;
    }
    if (this.status(config)?.signedIn) {
      return false;
    }
    let response: Response;
    try {
      response = await this.knock(serverName, config.transport.url, AbortSignal.timeout(OAUTH_DEFAULTS.checkTimeoutMs));
    } catch {
      return false;
    }
    if (response.status !== HttpStatus.Unauthorized) {
      return false;
    }
    this.needsSignIn.add(serverName);
    return true;
  }

  /**
   * Finishes a sign-in: trades the code the login sent back for tokens and stores them.
   *
   * @param state - The `state` the login echoed; it must name a flow this process started and that has not expired.
   * @param code - The authorization code.
   * @returns Which server signed in, and where the UI is. Throws a 400 for an unknown or expired `state`, and a 502
   * when the exchange fails.
   */
  async finish(state: string, code: string): Promise<FinishedFlow> {
    const flow = this.take(state);
    const url = this.remoteUrl(flow.serverName);
    try {
      await auth(new StoredOAuthProvider(this, flow.serverName, flow), {
        serverUrl: url,
        authorizationCode: code,
        fetchFn: this.fetchFn,
      });
    } catch (cause) {
      throw upstreamFailed(`Signing in to server "${flow.serverName}" failed`, errorMessage(cause), { cause });
    }
    this.needsSignIn.delete(flow.serverName);
    await this.onChange(flow.serverName);
    return { serverName: flow.serverName, uiOrigin: flow.uiOrigin };
  }

  /**
   * Ends a sign-in the login refused (the user cancelled, or it rejected the client).
   *
   * @param state - The flow's `state`.
   * @returns Which server it was and where the UI is, or undefined for a `state` this process does not know.
   */
  abandon(state: string): FinishedFlow | undefined {
    const flow = this.pending.get(state);
    this.pending.delete(state);
    return flow ? { serverName: flow.serverName, uiOrigin: flow.uiOrigin } : undefined;
  }

  /**
   * Signs a server out: forgets its tokens and registered client. A typed-in client and scope are kept.
   *
   * @param serverName - The server.
   */
  async signOut(serverName: string): Promise<void> {
    await this.write(
      serverName,
      ({ tokens: _t, tokensSavedAt: _s, clientInformation: _c, redirectUri: _r, ...kept }) => kept,
    );
    this.discoveryByServer.delete(serverName);
    this.needsSignIn.add(serverName);
    await this.onChange(serverName);
  }

  /** Forgets everything held in memory for a deleted server. */
  forget(serverName: string): void {
    this.needsSignIn.delete(serverName);
    this.discoveryByServer.delete(serverName);
    for (const [state, flow] of this.pending) {
      if (flow.serverName === serverName) {
        this.pending.delete(state);
      }
    }
  }

  /**
   * The flow a callback names, removed so a `state` works once.
   *
   * @param state - From the callback.
   * @returns The flow. Throws a 400 when there is none, or it is older than `OAUTH_DEFAULTS.flowTtlMs`.
   */
  private take(state: string): PendingFlow {
    const flow = this.pending.get(state);
    this.pending.delete(state);
    if (!flow || Date.now() - flow.createdAt > OAUTH_DEFAULTS.flowTtlMs) {
      throw badInput('This sign-in has expired or was already used. Start it again from MCP Router.');
    }
    return flow;
  }

  /** Drops the flows nobody finished. */
  private prune(): void {
    const cutoff = Date.now() - OAUTH_DEFAULTS.flowTtlMs;
    for (const [state, flow] of this.pending) {
      if (flow.createdAt < cutoff) {
        this.pending.delete(state);
      }
    }
  }

  /**
   * A server's URL, for a server that can sign in at all.
   *
   * @param serverName - The server.
   * @returns Its streamable-http URL. Throws a 400 for an unknown or stdio server.
   */
  private remoteUrl(serverName: string): string {
    const config = this.store.getServer(serverName);
    if (config?.transport.type !== TRANSPORT_STREAMABLE_HTTP) {
      throw badInput(`Server "${serverName}" is not a remote server, so it has no sign-in`);
    }
    return config.transport.url;
  }

  /**
   * Knocks on the server without a token, for the login it names in its 401.
   *
   * @param serverName - For the messages.
   * @param url - The server's URL.
   * @returns The `WWW-Authenticate` hints: where its resource metadata is, which scopes it wants. Throws a 400 when it
   * answers without asking for a login, and a 502 when it cannot be reached.
   */
  private async challenge(serverName: string, url: string): Promise<{ resourceMetadataUrl?: URL; scope?: string }> {
    let response: Response;
    try {
      response = await this.knock(serverName, url);
    } catch (cause) {
      throw upstreamFailed(`Could not reach server "${serverName}"`, errorMessage(cause), { cause });
    }
    if (response.status !== HttpStatus.Unauthorized) {
      throw badInput(
        `Server "${serverName}" did not ask for a sign-in`,
        `It answered ${response.status} without a token, so it does not use OAuth.`,
      );
    }
    const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
    return { resourceMetadataUrl, scope };
  }

  /**
   * Sends the server an `initialize` with its configured headers and no token, and reads only the status line.
   *
   * @param serverName - Whose configured headers to send.
   * @param url - Where.
   * @param [signal] - Aborts the request.
   * @returns The response, its body already discarded. Rejects when the server cannot be reached.
   */
  private async knock(serverName: string, url: string, signal?: AbortSignal): Promise<Response> {
    const transport = this.store.getServer(serverName)?.transport;
    const configured = transport?.type === TRANSPORT_STREAMABLE_HTTP ? transport.headers : {};
    const response = await this.fetchFn(url, {
      signal,
      method: 'POST',
      headers: {
        ...configured,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'mcp-router', version: SERVER_VERSION },
        },
      }),
    });
    await response.body?.cancel().catch(() => {});
    return response;
  }
}
