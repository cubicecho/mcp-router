import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { forwardElicitation, InFlightLedger } from '../in-flight.ts';
import { watchStream } from '../standalone-stream.ts';

/** A session's server as far as a forwarded question touches it: what its client declared, and the ask itself. */
function session(capabilities: ClientCapabilities, elicitInput: Server['elicitInput'] = vi.fn()) {
  return { getClientCapabilities: () => capabilities, elicitInput } as unknown as Server;
}

const QUESTION = {
  message: 'Who is asking?',
  requestedSchema: { type: 'object' as const, properties: { name: { type: 'string' as const } } },
};

/** A request that has not settled, run for `owner`. */
const running = (owner?: Server) => ({ session: owner, settled: new AbortController().signal });

describe('InFlightLedger', () => {
  it('names the one request in flight on an instance, and nothing once it settles', async () => {
    const ledger = new InFlightLedger();
    const owner = session({});
    let finish = () => {};
    const call = ledger.track('alpha', owner, () => new Promise<void>((resolve) => (finish = resolve)));

    expect(ledger.sole('alpha')?.session).toBe(owner);
    expect(ledger.sole('beta')).toBeUndefined();

    const { settled } = ledger.sole('alpha') ?? { settled: undefined };
    finish();
    await call;
    expect(ledger.sole('alpha')).toBeUndefined();
    expect(settled?.aborted).toBe(true);
  });

  it('names nobody while two requests are in flight on one instance', async () => {
    const ledger = new InFlightLedger();
    const finishers: Array<() => void> = [];
    const hold = () => new Promise<void>((resolve) => finishers.push(resolve));
    const calls = [ledger.track('alpha', session({}), hold), ledger.track('alpha', session({}), hold)];

    expect(ledger.sole('alpha')).toBeUndefined();

    for (const finish of finishers) {
      finish();
    }
    await Promise.all(calls);
  });

  it('lets go of a request that rejects', async () => {
    const ledger = new InFlightLedger();
    await expect(ledger.track('alpha', undefined, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(ledger.sole('alpha')).toBeUndefined();
  });
});

describe('forwardElicitation', () => {
  const signal = new AbortController().signal;

  it("asks the session's client and hands back its answer", async () => {
    const elicitInput = vi.fn(async () => ({ action: 'accept' as const, content: { name: 'tester' } }));
    const answer = await forwardElicitation(
      running(session({ elicitation: { form: {} } }, elicitInput)),
      QUESTION,
      signal,
      1_000,
    );

    expect(answer).toEqual({ action: 'accept', content: { name: 'tester' } });
    expect(elicitInput).toHaveBeenCalledWith(QUESTION, expect.objectContaining({ timeout: 1_000 }));
  });

  it('declines when no one request can be named, or it was made for no session', async () => {
    expect(await forwardElicitation(undefined, QUESTION, signal, 1_000)).toEqual({ action: 'decline' });
    expect(await forwardElicitation(running(), QUESTION, signal, 1_000)).toEqual({ action: 'decline' });
  });

  it('declines for a client that did not declare the mode asked for, without asking it', async () => {
    const elicitInput = vi.fn();
    const formOnly = running(session({ elicitation: { form: {} } }, elicitInput));
    const none = running(session({}, elicitInput));
    const link = { mode: 'url' as const, message: 'Sign in', url: 'https://example.com', elicitationId: '1' };

    expect(await forwardElicitation(formOnly, link, signal, 1_000)).toEqual({ action: 'decline' });
    expect(await forwardElicitation(none, QUESTION, signal, 1_000)).toEqual({ action: 'decline' });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('cancels once the call that asked has settled, rather than leaving the question open', async () => {
    const settled = new AbortController();
    const elicitInput = vi.fn(
      (_params: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const request = {
      session: session({ elicitation: { form: {} } }, elicitInput as Server['elicitInput']),
      settled: settled.signal,
    };

    const answer = forwardElicitation(request, QUESTION, signal, 1_000);
    settled.abort();

    expect(await answer).toEqual({ action: 'cancel' });
  });

  it('holds a question back until the session holds its GET stream, then asks', async () => {
    const elicitInput = vi.fn(async () => ({ action: 'accept' as const, content: { name: 'tester' } }));
    const owner = session({ elicitation: { form: {} } }, elicitInput);
    const stream = watchStream(owner);

    const answer = forwardElicitation(running(owner), QUESTION, signal, 1_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(elicitInput).not.toHaveBeenCalled();

    stream.attached();
    expect(await answer).toEqual({ action: 'accept', content: { name: 'tester' } });
  });

  it('cancels a question still waiting for its stream once the call that asked has settled', async () => {
    const elicitInput = vi.fn();
    const owner = session({ elicitation: { form: {} } }, elicitInput);
    watchStream(owner);
    const settled = new AbortController();

    const answer = forwardElicitation({ session: owner, settled: settled.signal }, QUESTION, signal, 1_000);
    settled.abort();

    expect(await answer).toEqual({ action: 'cancel' });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('asks straight away once a stream is held, and waits again after it is gone', async () => {
    const elicitInput = vi.fn(async () => ({ action: 'decline' as const }));
    const owner = session({ elicitation: { form: {} } }, elicitInput);
    const stream = watchStream(owner);
    stream.attached();

    await forwardElicitation(running(owner), QUESTION, signal, 1_000);
    expect(elicitInput).toHaveBeenCalledTimes(1);

    stream.detached();
    const settled = new AbortController();
    const answer = forwardElicitation({ session: owner, settled: settled.signal }, QUESTION, signal, 1_000);
    settled.abort();
    expect(await answer).toEqual({ action: 'cancel' });
    expect(elicitInput).toHaveBeenCalledTimes(1);
  });
});
