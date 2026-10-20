import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../../config/store.ts';
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
  let oauth: OAuthService;
  let manager: GatewayManager;
  let upstream: Upstream;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-oauth-'));
    store = new ConfigStore(dataDir);
    await store.init();
    token = store.getSettings().authToken as string;
    upstream = await startUpstream();
    oauth = new OAuthService(store);
    manager = new GatewayManager(() => store.getSettings(), oauth);
    oauth.setOnChange((name) => manager.resetServer(name));
    await manager.reconcile(store.getServers());
    app = createApp({ store, manager, oauth, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await store.close();
    await upstream.close();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  const addRemote = async () => {
    const res = await authed(request(app).post('/api/servers')).send({
      name: 'ha',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: upstream.url, headers: {} },
    });
    expect(res.status).toBe(201);
  };

  const signIn = async () => {
    const started = await authed(request(app).post('/api/servers/ha/oauth/start')).send({
      origin: 'http://router.test',
    });
    expect(started.status).toBe(200);
    const { code, state } = login(upstream, started.body.authorizationUrl);
    return request(app).get('/oauth/callback').query({ code, state });
  };

  it('adds a server that wants a login, signs in through the callback, and reaches its tools', async () => {
    await addRemote();

    const checked = await authed(request(app).post('/api/servers/ha/oauth/check'));
    expect(checked.body.state).toBe('needs-auth');
    expect(checked.body.oauth).toMatchObject({ signedIn: false });

    const refused = await authed(request(app).get('/api/servers/ha/tools'));
    expect(refused.status).toBe(502);
    expect(refused.body.error).toBe('Server "ha" needs you to sign in');

    const started = await authed(request(app).post('/api/servers/ha/oauth/start')).send({
      origin: 'http://router.test',
    });
    expect(started.body.signedIn).toBe(false);
    const { code, state, params } = login(upstream, started.body.authorizationUrl);
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

    const status = await authed(request(app).get('/api/servers/ha'));
    expect(status.body.config.oauth).toBeUndefined();
    expect(status.body.oauth).toMatchObject({ signedIn: true, refreshable: true });
    expect(JSON.stringify(status.body)).not.toContain('at-1');

    const tools = await authed(request(app).get('/api/servers/ha/tools'));
    expect(tools.status).toBe(200);
    expect(tools.body.tools.map((t: { name: string }) => t.name)).toEqual(['hello']);
    expect((await authed(request(app).get('/api/servers/ha'))).body.state).toBe('running');
  });

  it('refreshes an access token the server stopped accepting', async () => {
    await addRemote();
    await signIn();
    upstream.valid.delete('at-1');

    const tools = await authed(request(app).get('/api/servers/ha/tools'));

    expect(tools.status).toBe(200);
    expect(upstream.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1' });
    expect(store.getServer('ha')?.oauth?.tokens).toMatchObject({
      access_token: 'at-refreshed-1',
      refresh_token: 'rt-1',
    });
  });

  it('uses a callback state once, and refuses one it did not issue', async () => {
    await addRemote();
    const started = await authed(request(app).post('/api/servers/ha/oauth/start')).send({
      origin: 'http://router.test',
    });
    const { code, state } = login(upstream, started.body.authorizationUrl);

    expect((await request(app).get('/oauth/callback').query({ code, state: 'forged' })).status).toBe(400);
    expect((await request(app).get('/oauth/callback').query({ code, state })).status).toBe(200);
    expect((await request(app).get('/oauth/callback').query({ code, state })).status).toBe(400);
  });

  it('reports a login the user cancelled to the window that opened it', async () => {
    await addRemote();
    const started = await authed(request(app).post('/api/servers/ha/oauth/start')).send({
      origin: 'http://router.test',
    });
    const { state } = login(upstream, started.body.authorizationUrl);

    const res = await request(app).get('/oauth/callback').query({ state, error: 'access_denied' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('access_denied');
    expect(res.text).toContain('"ok":false');
    expect(store.getServer('ha')?.oauth?.tokens).toBeUndefined();
  });

  it('signs out, forgetting the tokens', async () => {
    await addRemote();
    await signIn();

    const res = await authed(request(app).delete('/api/servers/ha/oauth'));

    expect(res.body.oauth).toMatchObject({ signedIn: false });
    expect(res.body.state).toBe('needs-auth');
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

    const started = await authed(request(app).post('/api/servers/ha/oauth/start')).send({
      origin: 'http://localhost:3000',
    });
    const { params } = login(upstream, started.body.authorizationUrl);

    // Over HTTPS the SDK offers the metadata URL itself.
    expect(params.get('client_id')).toBe('https://router.example.com/oauth/client-metadata.json');
    expect(params.get('redirect_uri')).toBe('https://router.example.com/oauth/callback');
  });

  it('refuses to start a sign-in for a server that does not ask for one', async () => {
    await authed(request(app).post('/api/servers')).send({
      name: 'open',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: `${new URL(upstream.url).origin}/nothing`, headers: {} },
    });

    const res = await authed(request(app).post('/api/servers/open/oauth/start')).send({ origin: 'http://router.test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Server "open" did not ask for a sign-in');
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
