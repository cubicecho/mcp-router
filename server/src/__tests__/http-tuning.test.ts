import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEEP_ALIVE_TIMEOUT_MS } from '../defaults.ts';
import { outboundFetch, tuneInbound } from '../http-tuning.ts';

const servers: Server[] = [];

afterEach(async () => {
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

describe('outboundFetch', () => {
  // Past the 4 s the global fetch keeps an idle connection, so one connection means the timeout is this fetch's own.
  it('keeps a connection for 30 s unless told otherwise', async () => {
    const { url, connections } = await countingServer();
    for (const env of [{}, { HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS: '0' }]) {
      const fetch = outboundFetch(env);
      await (await fetch(url)).text();
      await pause(4500);
      await (await fetch(url)).text();
    }
    // One per fetch: each holds its own connections.
    expect(connections()).toBe(2);
  }, 15_000);

  it('takes HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS', async () => {
    const { url, connections } = await countingServer();
    const fetch = outboundFetch({ HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS: '100' });
    await (await fetch(url)).text();
    await pause(400);
    await (await fetch(url)).text();
    expect(connections()).toBe(2);
  });

  it('leaves the global fetch alone', async () => {
    const { url, connections } = await countingServer();
    outboundFetch({ HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS: '100' });
    await (await fetch(url)).text();
    await pause(400);
    await (await fetch(url)).text();
    expect(connections()).toBe(1);
  });
});
