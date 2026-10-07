import type { ActivityEntry } from '@mcp-router/shared';
import { errorDetailMessage } from '../core/errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import { McpMethod } from './mcp-method.ts';
import { toolCallFailed, toolErrorText } from './tool-result.ts';

/** What a call is recorded as. */
export interface RecordedCallContext {
  /** Which door the call came through. */
  via: ActivityEntry['via'];
  /** The MCP method; `tools/call` also has its result checked for `isError`. */
  method: string;
  /** The tool name, prompt name or resource URI, when the call has one. */
  target?: string;
  params?: unknown;
  /**
   * Skip recording successes; failures always record.
   *
   * @remarks
   * List ops arrive on every client (re)connect and list_changed, so recording their routine successes would evict
   * the targeted calls the Activity tab exists to show from the bounded per-server log.
   */
  failuresOnly?: boolean;
}

/**
 * Run a downstream call together with its activity entry: params, result or error, and timing from before the connect.
 *
 * @typeParam T - What the call resolves to.
 * @param record - Writes the entry to the log of the instance the call ran against.
 * @param ctx - What the entry says about the call.
 * @param run - The call, connect included.
 * @returns What `run` resolved to, a tool result with `isError` included (recorded as a failure).
 *
 * @remarks
 * A failure is recorded and re-raised as it was thrown; what it becomes for the caller's protocol is the caller's
 * business.
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
