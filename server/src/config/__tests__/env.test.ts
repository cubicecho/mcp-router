import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir, envToken, listenHost, listenPort, refusePlaceholderToken } from '../env.ts';

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

describe('refusePlaceholderToken', () => {
  it('refuses the placeholder token from .env.example', () => {
    expect(() => refusePlaceholderToken({ MCP_ROUTER_TOKEN: 'change-me' })).toThrow('openssl rand -hex 32');
  });

  it('accepts any other token, or none', () => {
    expect(() => refusePlaceholderToken({ MCP_ROUTER_TOKEN: 'a-real-secret' })).not.toThrow();
    expect(() => refusePlaceholderToken({})).not.toThrow();
  });

  it('ignores the placeholder when SECURE_LOCAL_NET has turned auth off', () => {
    expect(() => refusePlaceholderToken({ MCP_ROUTER_TOKEN: 'change-me', SECURE_LOCAL_NET: 'true' })).not.toThrow();
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
