import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode } from '@mcp-router/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigStore } from '../../config/store.ts';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../../http/app.ts';
import { applyOAuthClient, dropSignInOnMove, OAuthService } from '../service.ts';

/** What the stub login has seen and will accept. */
interface Upstream {
  url: string;
  /** Access tokens the MCP endpoint lets through. */
  valid: Set<string>;
  /** Token requests, as form fields. */
  tokenRequests: Record<string, string>[];
  /** Codes issued, with the PKCE challenge and redirect each was issued for. */
  codes: Map<string, { challenge: string; redirectUri: string; clientId: string }>;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

/**
 * One process playing both halves of an OAuth-protected MCP server, the way Home Assistant does: the protected
 * resource at /mcp and its own authorization server at the root, taking metadata URLs as client ids.
 */
async function startUpstream(): Promise<Upstream> {
  const state: Omit<Upstream, 'url' | 'close'> = { valid: new Set(), tokenRequests: [], codes: new Map() };
  let base = '';
  let refreshes = 0;
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
      return;
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      });
      return;
    }
    if (url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      state.tokenRequests.push(form);
      if (form.grant_type === 'refresh_token' && form.refresh_token === 'rt-1') {
        refreshes += 1;
        const access = `at-refreshed-${refreshes}`;
        state.valid.add(access);
        json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 3600 });
        return;
      }
      const issued = state.codes.get(form.code ?? '');
      const challenge = createHash('sha256')
        .update(form.code_verifier ?? '')
        .digest('base64url');
      if (
        form.grant_type !== 'authorization_code' ||
        !issued ||
        issued.challenge !== challenge ||
        issued.redirectUri !== form.redirect_uri ||
        issued.clientId !== form.client_id
      ) {
        json(res, 400, { error: 'invalid_grant' });
        return;
      }
      state.valid.add('at-1');
      json(res, 200, { access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1' });
      return;
    }
    if (url.pathname === '/mcp') {
      const bearer = req.headers.authorization?.replace(/^Bearer /, '');
      if (!bearer || state.valid.has(bearer) === false) {
        res
          .writeHead(401, {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          })
          .end();
        return;
      }
      const raw = await readBody(req);
      const mcp = new McpServer({ name: 'protected', version: '1.0.0' });
      mcp.registerTool('hello', { description: 'Says hello.' }, () => ({ content: [{ type: 'text', text: 'hi' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => void mcp.close());
      await mcp.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ...state,
    url: `${base}/mcp`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Plays the user at the login page: reads what the router asked for and issues a code for it. */
function login(upstream: Upstream, authorizationUrl: string): { code: string; state: string; params: URLSearchParams } {
  const params = new URL(authorizationUrl).searchParams;
  const code = `code-${upstream.codes.size + 1}`;
  upstream.codes.set(code, {
    challenge: params.get('code_challenge') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    clientId: params.get('client_id') ?? '',
  });
  return { code, state: params.get('state') ?? '', params };
}

describe('remote OAuth sign-in', () => {
  let dataDir: string;
  let store: ConfigStore;
  let database: Database;
  let oauth: OAuthService;
  let manager: GatewayManager;
  let upstream: Upstream;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-oauth-'));
    await resetTestDb(database);
    store = await createTestStore(database, dataDir);
    token = store.getSettings().authToken as string;
    upstream = await startUpstream();
    oauth = new OAuthService(store);
    manager = new GatewayManager(() => store.getSettings(), oauth);
    oauth.setOnChange((name) => manager.resetServer(name));
    await manager.reconcile(store.getServers());
    app = createApp({ db: database.db, store, manager, oauth, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await upstream.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  /**
   * Posts one operation to /graphql with the token.
   *
   * @param query - The operation.
   * @param [variables] - Its variables.
   * @returns The answer's body: `data`, and `errors` when it was refused.
   */
  const gql = async (query: string, variables?: Record<string, unknown>) =>
    (await authed(request(app).post('/graphql')).send({ query, variables })).body;

  /** What the sign-in mutations answer with: the server's live state. */
  const RUNTIME = 'state oauth { signedIn refreshable }';

  /**
   * Installs a remote server.
   *
   * @param name - Its local name.
   * @param url - Its endpoint.
   */
  const install = async (name: string, url: string) => {
    const { errors } = await gql('mutation($input: InstallServerInput!) { installServer(input: $input) { id } }', {
      input: { name, source: { type: 'remote' }, transport: { type: 'streamable-http', url, headers: {} } },
    });
    expect(errors).toBeUndefined();
  };

  const addRemote = () => install('ha', upstream.url);

  /**
   * Starts a sign-in through `startServerOAuth`.
   *
   * @param name - The server's name.
   * @param origin - The UI's origin.
   * @returns The answer's body.
   */
  const startSignIn = (name: string, origin: string) =>
    gql(
      'mutation($name: String!, $origin: String!) { startServerOAuth(name: $name, origin: $origin) { authorizationUrl signedIn } }',
      {
        name,
        origin,
      },
    );

  const signIn = async () => {
    const started = await startSignIn('ha', 'http://router.test');
    const { code, state } = login(upstream, started.data.startServerOAuth.authorizationUrl);
    return request(app).get('/oauth/callback').query({ code, state });
  };

  it('adds a server that wants a login, signs in through the callback, and reaches its tools', async () => {
    await addRemote();

    const checked = await gql(`mutation { checkServerOAuth(name: "ha") { ${RUNTIME} } }`);
    expect(checked.data.checkServerOAuth).toMatchObject({ state: 'NEEDS_AUTH', oauth: { signedIn: false } });

    const refused = await gql('{ serverTools(name: "ha") { name } }');
    expect(refused.errors[0].extensions.code).toBe(ErrorCode.UpstreamFailed);
    expect(refused.errors[0].message).toBe('Server "ha" needs you to sign in');

    const started = await startSignIn('ha', 'http://router.test');
    expect(started.data.startServerOAuth.signedIn).toBe(false);
    const { code, state, params } = login(upstream, started.data.startServerOAuth.authorizationUrl);
    // A plain-HTTP router still names itself by its metadata URL, which a Home Assistant-style login takes as the id.
    expect(params.get('client_id')).toBe('http://router.test/oauth/client-metadata.json');
    expect(params.get('redirect_uri')).toBe('http://router.test/oauth/callback');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('resource')).toBe(upstream.url);

    const callback = await request(app).get('/oauth/callback').query({ code, state });
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('postMessage');
    expect(callback.text).toContain('"http://router.test"');

    const stored = store.getServer('ha')?.oauth;
    expect(stored?.tokens).toMatchObject({ access_token: 'at-1', refresh_token: 'rt-1' });
    expect(stored?.redirectUri).toBe('http://router.test/oauth/callback');

    const status = await gql(
      `{ server(where: { name: { eq: "ha" } }) { name } serverRuntime(name: "ha") { ${RUNTIME} } }`,
    );
    expect(status.data.serverRuntime.oauth).toMatchObject({ signedIn: true, refreshable: true });
    expect(JSON.stringify(status)).not.toContain('at-1');

    const tools = await gql('{ serverTools(name: "ha") { name } }');
    expect(tools.data.serverTools).toEqual([{ name: 'hello' }]);
    expect((await gql('{ serverRuntime(name: "ha") { state } }')).data.serverRuntime.state).toBe('RUNNING');
  });

  it('refreshes an access token the server stopped accepting', async () => {
    await addRemote();
    await signIn();
    upstream.valid.delete('at-1');

    const tools = await gql('{ serverTools(name: "ha") { name } }');

    expect(tools.errors).toBeUndefined();
    expect(upstream.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
    expect(store.getServer('ha')?.oauth?.tokens).toMatchObject({
      access_token: 'at-refreshed-1',
      refresh_token: 'rt-1',
    });
  });

  it('uses a callback state once, and refuses one it did not issue', async () => {
    await addRemote();
    const started = await startSignIn('ha', 'http://router.test');
    const { code, state } = login(upstream, started.data.startServerOAuth.authorizationUrl);

    expect((await request(app).get('/oauth/callback').query({ code, state: 'forged' })).status).toBe(400);
    expect((await request(app).get('/oauth/callback').query({ code, state })).status).toBe(200);
    expect((await request(app).get('/oauth/callback').query({ code, state })).status).toBe(400);
  });

  it('reports a login the user cancelled to the window that opened it', async () => {
    await addRemote();
    const started = await startSignIn('ha', 'http://router.test');
    const { state } = login(upstream, started.data.startServerOAuth.authorizationUrl);

    const res = await request(app).get('/oauth/callback').query({ state, error: 'access_denied' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('access_denied');
    expect(res.text).toContain('"ok":false');
    expect(store.getServer('ha')?.oauth?.tokens).toBeUndefined();
  });

  it('signs out, forgetting the tokens', async () => {
    await addRemote();
    await signIn();

    const res = await gql(`mutation { signOutServerOAuth(name: "ha") { ${RUNTIME} } }`);

    expect(res.data.signOutServerOAuth).toMatchObject({ state: 'NEEDS_AUTH', oauth: { signedIn: false } });
    expect(store.getServer('ha')?.oauth?.tokens).toBeUndefined();
  });

  it('serves its client metadata at its client id, under publicUrl when set', async () => {
    await store.updateSettings({ publicUrl: 'https://router.example.com' });

    const res = await request(app).get('/oauth/client-metadata.json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      client_id: 'https://router.example.com/oauth/client-metadata.json',
      redirect_uris: ['https://router.example.com/oauth/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('signs in at publicUrl rather than the UI origin when it is set', async () => {
    await store.updateSettings({ publicUrl: 'https://router.example.com' });
    await addRemote();

    const started = await startSignIn('ha', 'http://localhost:3000');
    const { params } = login(upstream, started.data.startServerOAuth.authorizationUrl);

    // Over HTTPS the SDK offers the metadata URL itself.
    expect(params.get('client_id')).toBe('https://router.example.com/oauth/client-metadata.json');
    expect(params.get('redirect_uri')).toBe('https://router.example.com/oauth/callback');
  });

  it('refuses to start a sign-in for a server that does not ask for one', async () => {
    await install('open', `${new URL(upstream.url).origin}/nothing`);

    const res = await startSignIn('open', 'http://router.test');

    expect(res.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
    expect(res.errors[0].message).toBe('Server "open" did not ask for a sign-in');
  });
});

describe('applyOAuthClient', () => {
  it('drops the tokens when the client changes, and keeps them when it does not', () => {
    const signedIn = { clientId: 'a', tokens: { access_token: 't' }, redirectUri: 'http://r/oauth/callback' };

    expect(applyOAuthClient(signedIn, { clientId: 'b' })).toEqual({ clientId: 'b', redirectUri: signedIn.redirectUri });
    expect(applyOAuthClient(signedIn, { clientId: 'a' })).toEqual(signedIn);
    expect(applyOAuthClient({ clientId: 'a', clientSecret: 's' }, { clientId: 'a' })).toEqual({
      clientId: 'a',
      clientSecret: 's',
    });
    expect(applyOAuthClient({ clientId: 'a', clientSecret: 's' }, { clientId: 'a', clientSecret: '' })).toEqual({
      clientId: 'a',
    });
    expect(applyOAuthClient({ clientId: 'a' }, null)).toBeUndefined();
  });
});

describe('dropSignInOnMove', () => {
  const remote = (url: string) => ({
    name: 'r',
    enabled: true,
    source: { type: 'remote' as const },
    transport: { type: 'streamable-http' as const, url, headers: {} },
    env: {},
    envMeta: {},
    oauth: { clientId: 'kept', tokens: { access_token: 't' } },
  });

  it('forgets the tokens when the URL moves to another origin', () => {
    expect(dropSignInOnMove(remote('https://a.test/mcp'), remote('https://b.test/mcp')).oauth).toEqual({
      clientId: 'kept',
    });
  });

  it('keeps them for a new path on the same origin', () => {
    expect(dropSignInOnMove(remote('https://a.test/mcp'), remote('https://a.test/v2/mcp')).oauth?.tokens).toEqual({
      access_token: 't',
    });
  });
});
