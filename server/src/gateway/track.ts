import type { ActivityEntry } from '@mcp-router/shared';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { errorDetailMessage } from '../errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import type { WithClient } from './downstream.ts';
import { toolCallFailed, toolErrorText } from './tool-result.ts';

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

export interface TrackContext {
  via: ActivityEntry['via'];
  method: string;
  target?: string;
  params?: unknown;
  /**
   * Skip recording successes. List ops arrive on every client (re)connect and
   * list_changed, so recording their routine successes would flood the bounded
   * per-server log and evict the targeted tool/resource/prompt calls the
   * Activity tab exists to show. Failures always record.
   */
  failuresOnly?: boolean;
}

/**
 * Run a downstream call, recording its params + result/error and timing to the
 * server's activity log. Records both outcomes, converts a raw downstream
 * failure into a proper MCP error, and always re-raises.
 */
export async function track<T>(deps: ProxyDeps, name: string, ctx: TrackContext, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    // tools/call resolves (does not throw) for tool-level errors, flagging them
    // via `isError` on the result — so success/failure can't be inferred from
    // throw-vs-return alone. Derived here, once, so no call site can forget it.
    const failed = ctx.method === 'tools/call' && toolCallFailed(result);
    if (ctx.failuresOnly && !failed) {
      return result;
    }
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via: ctx.via,
      method: ctx.method,
      target: ctx.target,
      ok: !failed,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      result,
      error: failed ? toolErrorText(result) : undefined,
    });
    return result;
  } catch (err) {
    deps.recordActivity(name, {
      at: new Date().toISOString(),
      via: ctx.via,
      method: ctx.method,
      target: ctx.target,
      ok: false,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      error: errorDetailMessage(err),
    });
    throw toMcpError(err);
  }
}
