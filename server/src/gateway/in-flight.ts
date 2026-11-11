import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { InstanceKey } from './instance-key.ts';

/** One request the router has running on an instance, and the session it runs for. */
export interface RunningRequest {
  /** The upstream session's proxy server; absent for the router's own requests (the REST API, a closing session). */
  session?: Server;
  /** Aborts once the request settles, so whatever is waiting on its behalf stops waiting. */
  settled: AbortSignal;
}

/**
 * Counts the requests in flight on each instance, so a server→client message can be pinned on the one that caused it.
 *
 * @remarks
 * Every session reaching an instance shares its one connection, and SDK 1.30 tells a client nothing of which request
 * a server's log line or `elicitation/create` belongs to. What is left is elimination, as the pool does for its own
 * `call()` (agent-mcp-pool's `CallOptions.onLog` and `onElicit`): a message is a request's when that request is the
 * only one in flight on the connection. Those per-call options are not reachable from here — they hang off `call()`,
 * which resolves tools through the index this router turns off, and `use()` takes none — so the router counts its own
 * `use()`s. The pool's are the same requests: every path the router has to a downstream goes through `use()`, and the
 * pool's own pings go out only when nothing else is in flight.
 */
export class InFlightLedger {
  private readonly running = new Map<InstanceKey, Set<RunningRequest>>();

  /**
   * Holds a request as in flight on an instance until it settles.
   *
   * @typeParam T - What the request resolves to.
   * @param key - The instance it runs on.
   * @param session - The session it runs for, if any.
   * @param run - The request.
   * @returns What `run` resolved or rejected with.
   */
  async track<T>(key: InstanceKey, session: Server | undefined, run: () => Promise<T>): Promise<T> {
    const done = new AbortController();
    const request: RunningRequest = { session, settled: done.signal };
    const set = this.running.get(key) ?? new Set();
    this.running.set(key, set);
    set.add(request);
    try {
      return await run();
    } finally {
      set.delete(request);
      if (set.size === 0) {
        this.running.delete(key);
      }
      done.abort();
    }
  }

  /**
   * Names the one request in flight on an instance.
   *
   * @param key - The instance.
   * @returns The request, or undefined when there are none or several — two candidates are no answer.
   */
  sole(key: InstanceKey): RunningRequest | undefined {
    const set = this.running.get(key);
    if (set?.size !== 1) {
      return undefined;
    }
    const [only] = set;
    return only;
  }
}

/**
 * Asks the upstream client of the session behind a request what a downstream server asked the router.
 *
 * @param request - The one request in flight on the instance that asked, if one can be named.
 * @param params - The `elicitation/create` params, forwarded untouched.
 * @param signal - Aborts when the downstream gives up on its question.
 * @param timeoutMs - How long the upstream client may take; the call that caused the question is on the same clock.
 * @returns The upstream client's answer. `decline` when no session can be named or its client did not declare the
 * mode asked for, and `cancel` when the call settled, or the downstream gave up, before anyone answered.
 *
 * @remarks
 * Sent without a related request id, so it goes out on the session's GET stream: sessions answer in JSON, and a
 * JSON-mode transport has no stream to tie a request to. A client with no stream open never sees it, and the
 * question waits until the call it belongs to ends.
 */
export async function forwardElicitation(
  request: RunningRequest | undefined,
  params: ElicitParams,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ElicitAnswer> {
  const session = request?.session;
  const declared = session?.getClientCapabilities()?.elicitation;
  if (!request || !session || !declared?.[params.mode ?? 'form']) {
    return { action: 'decline' };
  }
  const gone = AbortSignal.any([signal, request.settled]);
  try {
    return await session.elicitInput(params, { signal: gone, timeout: timeoutMs });
  } catch (cause) {
    if (gone.aborted) {
      return { action: 'cancel' };
    }
    throw cause;
  }
}

/** The params of an `elicitation/create`, as the session's server sends them on. */
type ElicitParams = Parameters<Server['elicitInput']>[0];
/** What the upstream client answers one with. */
type ElicitAnswer = Awaited<ReturnType<Server['elicitInput']>>;
