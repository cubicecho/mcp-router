import type { ActivityEntry } from '@mcp-router/shared';
import { errorDetailMessage } from '../core/errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import { McpMethod } from './mcp-method.ts';
import { toolCallFailed, toolErrorText } from './tool-result.ts';

export interface RecordedCallContext {
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
 * Run a downstream call together with its activity entry: params, result or error, and timing
 * from before the connect. A failure is recorded and re-raised as it was thrown; what it becomes
 * for the caller's protocol is the caller's business.
 *
 * @param record - Writes the entry to the log of the instance the call ran against.
 */
export async function recordedCall<T>(
  record: (entry: ActivityRecord) => void,
  ctx: RecordedCallContext,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const write = (outcome: Pick<ActivityRecord, 'ok' | 'result' | 'error'>): void =>
    record({
      at: new Date().toISOString(),
      via: ctx.via,
      method: ctx.method,
      target: ctx.target,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      ...outcome,
    });
  let result: T;
  try {
    result = await run();
  } catch (err) {
    write({ ok: false, error: errorDetailMessage(err) });
    throw err;
  }
  // tools/call resolves (does not throw) for tool-level errors, flagging them
  // via `isError` on the result — so success/failure can't be inferred from
  // throw-vs-return alone. Derived here, once, so no call site can forget it.
  const failed = ctx.method === McpMethod.ToolsCall && toolCallFailed(result);
  const isRecorded = ctx.failuresOnly !== true || failed;
  if (isRecorded) {
    write({ ok: failed === false, result, error: failed ? toolErrorText(result) : undefined });
  }
  return result;
}
