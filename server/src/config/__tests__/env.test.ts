import { describe, expect, it } from 'vitest';
import { listenPort, refusePlaceholderToken } from '../env.ts';

describe('listenPort', () => {
  it('uses the settings port when PORT is unset or empty', () => {
    expect(listenPort({}, 3001)).toBe(3001);
    expect(listenPort({ PORT: '' }, 3001)).toBe(3001);
  });

  it('prefers PORT over the settings port', () => {
    expect(listenPort({ PORT: '8080' }, 3001)).toBe(8080);
  });

  it.each(['abc', '80.5', '-1', '70000'])('refuses PORT=%s and says what to set', (raw) => {
    expect(() => listenPort({ PORT: raw }, 3001)).toThrow(`PORT is "${raw}", which is not a port number`);
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
