import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stopOnSignals } from '../http/shutdown.ts';

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** Long enough that the deadline timer never fires in a test, where `process.exit` is only mocked until the test ends. */
const NO_DEADLINE = { shutdownDeadlineSeconds: 3600 };

/** Starts a server that never answers, so a request to it stays in flight. */
const listen = async (): Promise<Server> => {
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
};

describe('stopOnSignals', () => {
  const existing = new Map(SIGNALS.map((signal) => [signal, process.listeners(signal)]));

  afterEach(() => {
    for (const signal of SIGNALS) {
      for (const listener of process.listeners(signal)) {
        const isOurs = existing.get(signal)?.includes(listener) === false;
        if (isOurs) {
          process.off(signal, listener);
        }
      }
    }
    vi.restoreAllMocks();
  });

  it('runs before, closes the server, runs after, then exits 0', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await listen();
    const order: string[] = [];
    server.on('close', () => order.push('closed'));
    stopOnSignals(
      server,
      {
        before: () => order.push('before'),
        after: async () => {
          order.push('after');
        },
      },
      NO_DEADLINE,
    );

    process.emit('SIGTERM', 'SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(order).toEqual(['before', 'closed', 'after']);
    expect(server.listening).toBe(false);
  });

  it('cuts a request that outlives the drain time', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await listen();
    const { port } = server.address() as AddressInfo;
    const hung = fetch(`http://127.0.0.1:${port}/`).catch((error: unknown) => error);
    await vi.waitFor(async () => {
      const connections = await new Promise<number>((resolve) =>
        server.getConnections((_error, count) => resolve(count)),
      );
      expect(connections).toBe(1);
    });
    stopOnSignals(server, {}, { ...NO_DEADLINE, drainSeconds: 0.05 });

    process.emit('SIGTERM', 'SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(await hung).toBeInstanceOf(Error);
  });

  it('exits 1 at once on a second signal', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await listen();
    // Never resolves, so the first signal is still stopping when the second arrives.
    stopOnSignals(server, { after: () => new Promise(() => {}) }, NO_DEADLINE);

    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGINT', 'SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 when a step fails', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = await listen();
    stopOnSignals(server, { after: () => Promise.reject(new Error('pool stuck')) }, NO_DEADLINE);

    process.emit('SIGTERM', 'SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(error).toHaveBeenCalledWith('[server] shutdown failed: pool stuck');
  });
});
