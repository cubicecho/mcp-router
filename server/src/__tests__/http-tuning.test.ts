import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS,
  tuneInbound,
  tuneOutbound,
} from '../http-tuning.ts';

const servers: Server[] = [];
const originalDispatcher = getGlobalDispatcher();

afterEach(async () => {
  const dispatcher = getGlobalDispatcher();
  if (dispatcher !== originalDispatcher) {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher.close();
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** A server that counts the TCP connections opened to it. `keepAliveTimeout: 0` sends no `Keep-Alive` hint. */
async function countingServer(): Promise<{ url: string; connections: () => number }> {
  let connections = 0;
  const server = createServer({ keepAliveTimeout: 0 }, (_req, res) => {
    res.end('{}');
  });
  server.on('connection', () => {
    connections += 1;
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, connections: () => connections };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('tuneInbound', () => {
  it('raises keepAliveTimeout above the Node default', () => {
    const server = createServer();
    expect(tuneInbound(server, {})).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  });

  it('takes HTTP_KEEP_ALIVE_TIMEOUT_MS, including 0 for no timeout', () => {
    const server = createServer();
    expect(tuneInbound(server, { HTTP_KEEP_ALIVE_TIMEOUT_MS: '120000' })).toBe(120_000);
    expect(server.keepAliveTimeout).toBe(120_000);
    expect(tuneInbound(server, { HTTP_KEEP_ALIVE_TIMEOUT_MS: '0' })).toBe(0);
  });

  it.each(['', 'soon', '-1', '1.5'])('falls back to the default for %j', (value) => {
    expect(tuneInbound(createServer(), { HTTP_KEEP_ALIVE_TIMEOUT_MS: value })).toBe(DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  });
});

describe('tuneOutbound', () => {
  it('defaults when unset or not a positive whole number', () => {
    expect(tuneOutbound({})).toBe(DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS);
    expect(tuneOutbound({ HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS: '0' })).toBe(DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS);
  });

  it('keeps a connection for reuse by the global fetch', async () => {
    const { url, connections } = await countingServer();
    tuneOutbound({});
    await (await fetch(url)).text();
    await pause(50);
    await (await fetch(url)).text();
    expect(connections()).toBe(1);
  });

  // Proves the global fetch runs on this dispatcher: a default one would still hold the connection.
  it('applies its timeout to the global fetch', async () => {
    const { url, connections } = await countingServer();
    tuneOutbound({ HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS: '100' });
    await (await fetch(url)).text();
    await pause(400);
    await (await fetch(url)).text();
    expect(connections()).toBe(2);
  });
});
