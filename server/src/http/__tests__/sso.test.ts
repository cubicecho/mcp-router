import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import { eq } from 'drizzle-orm';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthHost, createAuthHost } from '../../auth/auth-host.ts';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { users } from '../../db/tables/users.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../app.ts';
import { SSO_CALLBACK_PATH, SSO_START_PATH } from '../sso.ts';

/** What the test instances sign with. */
const TEST_SECRET = 'test-secret-for-the-router-tests-only-0123456789';

// The whole OIDC sign-in through the real app, against a stand-in provider that
// does what heautou (oidc-provider) does: discovery, a JWKS, a code flow with a
// client secret in a Basic header, PKCE, and a signed id token carrying the nonce.

const VERIFY = 'mutation ($token: String!) { verifyOneTimeToken(token: $token) { token userId } }';
const CONFIG = '{ authConfig { sso { name signInUrl } } }';
const CLIENT_ID = 'mcp-router';
const CLIENT_SECRET = 'mcp-router-secret';

interface Profile {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

interface FakeProvider {
  issuer: string;
  /** Who the next sign-in is. */
  profile: Profile;
  /** Plays the browser at the authorize endpoint: the code and state it would be sent back with. */
  authorize(url: string): { code: string; state: string };
  close(): Promise<void>;
}

/**
 * Listens on a free loopback port.
 *
 * @param app - What to serve.
 * @returns The server, and the origin it answers on.
 */
async function listen(app: express.Express): Promise<{ server: Server; origin: string }> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/**
 * Stops a server.
 *
 * @param server - The server to stop.
 * @returns Once it has stopped.
 */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Starts the stand-in provider on a port of its own.
 *
 * @returns The provider, signing the next sign-in in as Ada.
 */
async function startProvider(): Promise<FakeProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; profile: Profile }>();
  const app = express();
  const { server, origin } = await listen(app);
  const issuer = `${origin}/oidc`;
  const provider: FakeProvider = {
    issuer,
    profile: { sub: 'u1', email: 'ada@example.com', name: 'Ada' },
    authorize(url) {
      const params = new URL(url).searchParams;
      expect(params.get('client_id')).toBe(CLIENT_ID);
      expect(params.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['openid', 'email', 'profile']));
      expect(params.get('code_challenge_method')).toBe('S256');
      const code = randomUUID();
      codes.set(code, {
        nonce: params.get('nonce') ?? '',
        challenge: params.get('code_challenge') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
        profile: provider.profile,
      });
      return { code, state: params.get('state') ?? '' };
    },
    close: () => close(server),
  };

  app.get('/oidc/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/me`,
      jwks_uri: `${issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    });
  });
  app.get('/oidc/jwks', (_req, res) => {
    res.json({ keys: [jwk] });
  });
  app.post('/oidc/token', express.urlencoded({ extended: false }), async (req, res) => {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    if (req.headers.authorization !== `Basic ${basic}`) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }
    const grant = codes.get(req.body.code);
    codes.delete(req.body.code);
    const challenge = createHash('sha256').update(String(req.body.code_verifier)).digest('base64url');
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== req.body.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    const { profile } = grant;
    const idToken = await new SignJWT({
      ...profile,
      email_verified: profile.email ? true : undefined,
      nonce: grant.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setSubject(profile.sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res.json({ access_token: `at-${profile.sub}`, token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  app.get('/oidc/me', (req, res) => {
    const sub = String(req.headers.authorization).replace('Bearer at-', '');
    const profile = sub === provider.profile.sub ? provider.profile : null;
    res.json(profile ? { ...profile, email_verified: Boolean(profile.email) } : {});
  });
  return provider;
}

let database: Database;
let provider: FakeProvider;
let authHost: AuthHost;
let manager: GatewayManager;
let dataDir: string;
let router: Server;
let appUrl: string;

beforeAll(async () => {
  database = await createTestDb();
});

afterAll(() => database.close());

beforeEach(async () => {
  await resetTestDb(database);
  provider = await startProvider();
  // Logged refusals are expected here; keep them out of the run's output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  // createApp builds the routes before it is listening, and the router's address has to name the port it ends up on,
  // so the app is mounted into an outer one.
  const outer = express();
  ({ server: router, origin: appUrl } = await listen(outer));
  vi.stubEnv('OIDC_ISSUER', provider.issuer);
  vi.stubEnv('OIDC_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('OIDC_CLIENT_SECRET', CLIENT_SECRET);
  vi.stubEnv('OIDC_NAME', 'heautou');
  authHost = await createAuthHost(database.db, { baseUrl: () => appUrl, secret: TEST_SECRET });
  dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-sso-'));
  const store = await createTestStore(database, dataDir);
  manager = new GatewayManager(() => store.getSettings());
  outer.use(createApp({ db: database.db, authHost, store, manager, appDistDir: path.join(dataDir, 'no-such-dist') }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await manager.stopAll();
  await close(router);
  await provider.close();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * Posts one operation to the running router's /graphql, signed out.
 *
 * @param query - The operation.
 * @param [variables] - Its variables.
 * @returns The answer's body.
 */
async function gql(query: string, variables?: Record<string, unknown>) {
  const response = await fetch(`${appUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

/**
 * Reads the cookies a response set, as a request's Cookie header.
 *
 * @param response - The response.
 * @returns The header value.
 */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * Walks the browser through a sign-in: the start route, the provider, the callback.
 *
 * @param [tamper] - Changes the provider's redirect before the browser follows it.
 * @returns Where the callback sent the browser, and the callback's response.
 */
async function signIn(tamper?: (callback: URL) => void): Promise<{ location: URL; callback: Response }> {
  const start = await fetch(`${appUrl}${SSO_START_PATH}`, { redirect: 'manual' });
  expect(start.status).toBe(HttpStatus.Found);
  const authorizeUrl = start.headers.get('location') ?? '';
  expect(authorizeUrl.startsWith(`${provider.issuer}/auth?`)).toBe(true);
  expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(`${appUrl}${SSO_CALLBACK_PATH}`);

  const { code, state } = provider.authorize(authorizeUrl);
  const back = new URL(`${appUrl}${SSO_CALLBACK_PATH}`);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  back.searchParams.set('iss', provider.issuer);
  tamper?.(back);
  const callback = await fetch(back, { redirect: 'manual', headers: { cookie: cookiesFrom(start) } });
  expect(callback.status).toBe(HttpStatus.Found);
  return { location: new URL(callback.headers.get('location') ?? ''), callback };
}

/**
 * Swaps a one-time token for a session, as the UI's /auth/sso page does.
 *
 * @param token - The token from the callback's redirect.
 * @returns The GraphQL answer.
 */
function verify(token: string) {
  return gql(VERIFY, { token });
}

/**
 * Asks better-auth whose a bearer session is.
 *
 * @param token - The session token.
 * @returns The user id, or undefined for no session.
 */
async function sessionUserId(token: string): Promise<string | undefined> {
  const session = await authHost
    .current()
    .api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
  return session?.user.id;
}

/**
 * Reads a user's name straight from the database.
 *
 * @param id - The user.
 * @returns The name, or null when it has none.
 */
async function nameOf(id: string): Promise<string | null> {
  const [user] = await database.db.select({ name: users.name }).from(users).where(eq(users.id, id));
  return user?.name ?? null;
}

type Verified = { verifyOneTimeToken: { token: string; userId: string } };

describe('OIDC sign-in', () => {
  it('lands on /auth/sso with a one-time token the app swaps for a session', async () => {
    const { location, callback } = await signIn();
    expect(location.origin + location.pathname).toBe(`${appUrl}/auth/sso`);
    // The session goes to the app as a bearer token, never as a cookie.
    expect(callback.headers.getSetCookie().some((cookie) => cookie.includes('session_token'))).toBe(false);

    const token = location.searchParams.get('token') ?? '';
    const result = await verify(token);
    expect(result.errors).toBeUndefined();
    // The session the UI then keeps is the operator's.
    const me = await fetch(`${appUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${result.data.verifyOneTimeToken.token}` },
      body: JSON.stringify({ query: '{ me { email role } }' }),
    });
    expect((await me.json()).data.me).toEqual({ email: 'ada@example.com', role: 'admin' });
    const session = (result.data as Verified).verifyOneTimeToken;
    expect(await sessionUserId(session.token)).toBe(session.userId);
    expect(await nameOf(session.userId)).toBe('Ada');

    // Spent, and a spent token is bad input, not a signed-out session.
    const again = await verify(token);
    expect(again.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);
  });

  it('signs an existing account in by the address the provider vouches for', async () => {
    const [existing] = await database.db
      .insert(users)
      .values({ email: 'ada@example.com', name: 'ada' })
      .returning({ userId: users.id });
    const { location } = await signIn();
    const result = await verify(location.searchParams.get('token') ?? '');
    expect((result.data as Verified).verifyOneTimeToken.userId).toBe(existing?.userId);
  });

  it('names a new account from the username when there is no name', async () => {
    provider.profile = { sub: 'u2', email: 'bob@example.com', preferred_username: 'bob' };
    const { location } = await signIn();
    const result = await verify(location.searchParams.get('token') ?? '');
    expect(await nameOf((result.data as Verified).verifyOneTimeToken.userId)).toBe('bob');
  });

  it('sends a user with no address back to the login page', async () => {
    provider.profile = { sub: 'u3', name: 'No Mail' };
    const { location } = await signIn();
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('token')).toBeNull();
  });

  it('refuses a callback whose state does not match', async () => {
    const { location } = await signIn((back) => back.searchParams.set('state', 'forged'));
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBeTruthy();
    expect(location.searchParams.get('token')).toBeNull();
  });
});

describe('authConfig.sso', () => {
  it('names the provider and where to start', async () => {
    const { data } = await gql(CONFIG);
    expect(data.authConfig.sso).toEqual({ name: 'heautou', signInUrl: `${appUrl}${SSO_START_PATH}` });
  });
});
