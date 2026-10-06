import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorDetailMessage } from '../errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import type { WithClient } from './downstream.ts';
import { type RecordedCallContext, recordedCall } from './recorded-call.ts';

/** Empty completion result used when a downstream server has no completions capability. */
export const EMPTY_COMPLETION = { completion: { values: [], total: 0, hasMore: false } };

/** Propagate a downstream failure as a proper MCP error. */
function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) {
    return err;
  }
  return new McpError(ErrorCode.InternalError, errorDetailMessage(err));
}

export interface ProxyDeps {
  withClient: WithClient;
  recordToolCount: (name: string, count: number) => void;
  recordActivity: (name: string, entry: ActivityRecord) => void;
}

export type TrackContext = RecordedCallContext;

/**
 * Run a downstream call, recording its params + result/error and timing to the
 * server's activity log. Records both outcomes, converts a raw downstream
 * failure into a proper MCP error, and always re-raises.
 */
export async function track<T>(deps: ProxyDeps, name: string, ctx: TrackContext, run: () => Promise<T>): Promise<T> {
  try {
    return await recordedCall((entry) => deps.recordActivity(name, entry), ctx, run);
  } catch (err) {
    throw toMcpError(err);
  }
}
