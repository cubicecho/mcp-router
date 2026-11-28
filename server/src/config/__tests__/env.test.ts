import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  databaseUrl,
  dataDir,
  envToken,
  listenHost,
  listenPort,
  oidcConfig,
  publicLocalNetError,
  refuseBadAuthConfig,
  routerUrl,
  secureLocalNet,
  trustProxy,
} from '../env.ts';

describe('databaseUrl', () => {
  it('returns a postgres:// or postgresql:// URL, trimmed', () => {
    expect(databaseUrl({ DATABASE_URL: ' postgres://u:p@postgres:5432/router ' })).toBe(
      'postgres://u:p@postgres:5432/router',
    );
    expect(databaseUrl({ DATABASE_URL: 'postgresql://db/router' })).toBe('postgresql://db/router');
  });

  it.each([{}, { DATABASE_URL: '' }, { DATABASE_URL: '   ' }])('refuses a missing DATABASE_URL (%o)', (env) => {
    expect(() => databaseUrl(env)).toThrow('[db] DATABASE_URL is not set');
  });

  it.each(['memory://', '/data/pg', 'mysql://u:secret@db/router'])('refuses a non-Postgres URL: %s', (url) => {
    expect(() => databaseUrl({ DATABASE_URL: url })).toThrow('[db] DATABASE_URL must be a postgres://');
    expect(() => databaseUrl({ DATABASE_URL: url })).not.toThrow('secret');
  });
});

describe('listenPort', () => {
  it('uses the settings port when PORT is unset or empty', () => {
    expect(listenPort(3001, {})).toBe(3001);
    expect(listenPort(3001, { PORT: '' })).toBe(3001);
  });

  it('prefers PORT over the settings port', () => {
    expect(listenPort(3001, { PORT: '8080' })).toBe(8080);
  });

  it.each(['abc', '80.5', '-1', '70000'])('refuses PORT=%s and says what to set', (raw) => {
    expect(() => listenPort(3001, { PORT: raw })).toThrow(`PORT is "${raw}", which is not a port number`);
  });
});

describe('refuseBadAuthConfig', () => {
  const strong = { BETTER_AUTH_SECRET: 'a'.repeat(64) };

  it('refuses the placeholder token, which would become a guessable API key', () => {
    expect(() => refuseBadAuthConfig({ MCP_ROUTER_TOKEN: 'change-me' })).toThrow('openssl rand -hex 32');
    expect(() => refuseBadAuthConfig({ MCP_ROUTER_TOKEN: 'change-me', SECURE_LOCAL_NET: 'true' })).toThrow();
  });

  it('accepts any other token, or none', () => {
    expect(() => refuseBadAuthConfig({ MCP_ROUTER_TOKEN: 'a-real-secret' })).not.toThrow();
    expect(() => refuseBadAuthConfig({})).not.toThrow();
  });

  it('refuses a missing, published or short signing secret in production only', () => {
    expect(() => refuseBadAuthConfig({ NODE_ENV: 'production' })).toThrow('BETTER_AUTH_SECRET is not set');
    expect(() =>
      refuseBadAuthConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'change-me-to-a-long-random-string' }),
    ).toThrow('published default');
    expect(() => refuseBadAuthConfig({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'short' })).toThrow('shorter');
    expect(() => refuseBadAuthConfig({ NODE_ENV: 'production', ...strong })).not.toThrow();
  });

  it('refuses half an OIDC setup, an issuer that is not a URL, and an unknown client auth', () => {
    expect(() => refuseBadAuthConfig({ OIDC_ISSUER: 'https://id.example.com' })).toThrow('go together');
    expect(() => refuseBadAuthConfig({ OIDC_CLIENT_ID: 'router' })).toThrow('go together');
    expect(() => refuseBadAuthConfig({ OIDC_ISSUER: 'nope', OIDC_CLIENT_ID: 'router' })).toThrow('not a URL');
    expect(() =>
      refuseBadAuthConfig({ OIDC_ISSUER: 'https://id.example.com', OIDC_CLIENT_ID: 'r', OIDC_CLIENT_AUTH: 'magic' }),
    ).toThrow('OIDC_CLIENT_AUTH');
  });
});

describe('oidcConfig', () => {
  it('reads the provider when issuer and client id are both set', () => {
    expect(oidcConfig({ OIDC_ISSUER: 'https://id.example.com/', OIDC_CLIENT_ID: 'router' })).toEqual({
      issuer: 'https://id.example.com',
      clientId: 'router',
      clientSecret: undefined,
      clientAuth: 'client_secret_basic',
      name: 'SSO',
    });
    expect(oidcConfig({ OIDC_ISSUER: 'https://id.example.com' })).toBeNull();
  });
});

describe('secureLocalNet and publicLocalNetError', () => {
  it('reads the switch, off when unset', () => {
    expect(secureLocalNet({})).toBe(false);
    for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(secureLocalNet({ SECURE_LOCAL_NET: value })).toBe(true);
    }
    expect(secureLocalNet({ SECURE_LOCAL_NET: 'false' })).toBe(false);
  });

  it('refuses a public router address under SECURE_LOCAL_NET unless told it is meant', () => {
    const on = { SECURE_LOCAL_NET: 'true' };
    expect(publicLocalNetError('https://router.example.com', on)).toContain('I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC');
    expect(publicLocalNetError('http://192.168.1.10:3000', on)).toBeUndefined();
    expect(publicLocalNetError('http://router.lan', on)).toBeUndefined();
    expect(publicLocalNetError('http://localhost:3000', on)).toBeUndefined();
    expect(
      publicLocalNetError('https://router.example.com', { ...on, I_KNOW_SECURE_LOCAL_NET_IS_PUBLIC: 'true' }),
    ).toBeUndefined();
    expect(publicLocalNetError('https://router.example.com', {})).toBeUndefined();
  });
});

describe('routerUrl', () => {
  it('is publicUrl without a trailing slash, or localhost on the port', () => {
    expect(routerUrl({ publicUrl: 'https://router.example.com/', port: 3000 }, {})).toBe('https://router.example.com');
    expect(routerUrl({ port: 3000 }, {})).toBe('http://localhost:3000');
    expect(routerUrl({ port: 3000 }, { PORT: '8080' })).toBe('http://localhost:8080');
  });
});

describe('trustProxy', () => {
  it('is off by default, and reads hop counts, switches and Express values', () => {
    expect(trustProxy({})).toBe(false);
    expect(trustProxy({ TRUST_PROXY: '1' })).toBe(1);
    expect(trustProxy({ TRUST_PROXY: 'true' })).toBe(true);
    expect(trustProxy({ TRUST_PROXY: 'off' })).toBe(false);
    expect(trustProxy({ TRUST_PROXY: 'loopback' })).toBe('loopback');
  });
});

describe('dataDir', () => {
  it('resolves DATA_DIR, or ./data when it is unset', () => {
    expect(dataDir({ DATA_DIR: '/srv/router' })).toBe('/srv/router');
    expect(dataDir({})).toBe(path.resolve('./data'));
  });
});

describe('listenHost', () => {
  it('prefers HOST over the settings host', () => {
    expect(listenHost('0.0.0.0', { HOST: '127.0.0.1' })).toBe('127.0.0.1');
    expect(listenHost('0.0.0.0', {})).toBe('0.0.0.0');
    expect(listenHost(undefined, {})).toBeUndefined();
  });
});

describe('envToken', () => {
  it('reads MCP_ROUTER_TOKEN, and treats an empty value as unset', () => {
    expect(envToken({ MCP_ROUTER_TOKEN: 'secret' })).toBe('secret');
    expect(envToken({ MCP_ROUTER_TOKEN: '' })).toBeUndefined();
    expect(envToken({})).toBeUndefined();
  });
});
