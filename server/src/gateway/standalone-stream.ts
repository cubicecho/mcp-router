import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Whether a session's client is holding its GET stream open, and a wait for when it is.
 *
 * @remarks
 * What a session sends with no request to answer goes out on that stream, and the SDK drops it without a word when
 * the stream is not there. A notification lost that way is a missed hint; a question lost that way is a call that
 * hangs until its timeout, waiting on an answer nobody was asked for. An SDK client opens the stream only after its
 * `initialized`, and does not wait for it before its first call, so a tool that asks straight away can get there
 * first.
 */
export class StandaloneStream {
  private held = 0;
  private readonly waiting = new Set<() => void>();

  /** True while at least one GET stream is held. */
  get open(): boolean {
    return this.held > 0;
  }

  /** Notes a GET stream attached, and lets go of everything waiting for one. */
  attached(): void {
    this.held += 1;
    for (const wake of this.waiting) {
      wake();
    }
    this.waiting.clear();
  }

  /** Notes a GET stream gone. */
  detached(): void {
    this.held = Math.max(0, this.held - 1);
  }

  /**
   * Waits until a GET stream is held.
   *
   * @param signal - Stops the wait.
   * @returns True once a stream is held, false when `signal` aborted first.
   */
  whenOpen(signal: AbortSignal): Promise<boolean> {
    if (this.open) {
      return Promise.resolve(true);
    }
    if (signal.aborted) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const wake = () => {
        signal.removeEventListener('abort', stop);
        resolve(true);
      };
      const stop = () => {
        this.waiting.delete(wake);
        resolve(false);
      };
      this.waiting.add(wake);
      signal.addEventListener('abort', stop, { once: true });
    });
  }
}

/** Each session's stream, by its proxy server: what a request in flight names its session by. */
const streams = new WeakMap<Server, StandaloneStream>();

/**
 * Starts watching a session's GET stream.
 *
 * @param server - The session's proxy server.
 * @returns The stream's watch, which the session registry drives.
 */
export function watchStream(server: Server): StandaloneStream {
  const stream = new StandaloneStream();
  streams.set(server, stream);
  return stream;
}

/**
 * Finds the watch on a session's GET stream.
 *
 * @param server - The session's proxy server.
 * @returns Its watch; undefined for a server no session registry started, which has no stream to wait for.
 */
export function streamOf(server: Server): StandaloneStream | undefined {
  return streams.get(server);
}
