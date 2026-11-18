import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorDetailMessage } from '../core/errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import type { WithClient } from './downstream.ts';
import { type RecordedCallContext, recordedCall } from './recorded-call.ts';

/** Empty completion result used when a downstream server has no completions capability. */
export const EMPTY_COMPLETION = { completion: { values: [], total: 0, hasMore: false } };

/**
 * Turns a downstream failure into a proper MCP error.
 *
 * @param err - The thrown value.
 * @returns The value itself when it is already an McpError, else an InternalError carrying its message and detail.
 */
function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) {
    return err;
  }
  return new McpError(ErrorCode.InternalError, errorDetailMessage(err));
}

/** What a proxy server needs from the manager, by server name as the endpoint exposes it. */
export interface ProxyDeps {
  withClient: WithClient;
  /** Notes how many tools the named server last listed. */
  recordToolCount: (name: string, count: number) => void;
  /** Writes an entry to the named server's activity log. */
  recordActivity: (name: string, entry: ActivityRecord) => void;
  /** How long one `tools/call` to the named server may take, in ms. */
  callTimeoutMs: (name: string) => number;
  /** Notes that `session` holds a subscription to `uri` on the named server (see `SubscriptionLedger`). */
  holdSubscription: (name: string, uri: string, session: object) => void;
  /** Lets go of one; true when nobody holds `uri` any longer, which is when the downstream should be told. */
  releaseSubscription: (name: string, uri: string, session: object) => boolean;
  /** Lets go of everything `session` holds as it closes, unsubscribing downstream from what nobody else does. */
  releaseSubscriptions: (session: object) => void;
}

/**
 * Run a downstream call, recording its params, result or error, and timing to the server's activity log.
 *
 * @typeParam T - What the call resolves to.
 * @param deps - Holds the activity log.
 * @param name - The server whose log gets the entry.
 * @param ctx - What the entry says about the call.
 * @param run - The call.
 * @returns What `run` resolved to. A failure is recorded, then thrown as an McpError.
 */
export async function track<T>(
  deps: ProxyDeps,
  name: string,
  ctx: RecordedCallContext,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await recordedCall((entry) => deps.recordActivity(name, entry), ctx, run);
  } catch (err) {
    throw toMcpError(err);
  }
}
