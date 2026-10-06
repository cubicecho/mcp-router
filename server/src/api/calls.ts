import { errorDetailMessage, errorMessage, HttpError } from '../errors.ts';
import type { DownstreamClient } from '../gateway/downstream.ts';
import type { InstanceKey } from '../gateway/instance-key.ts';
import type { GatewayManager } from '../gateway/manager.ts';

export interface UiCallContext {
  method: string;
  target: string;
  params: unknown;
  failLabel: string;
  /** Map a result that resolves but signals failure (e.g. a tool's `isError`) to its error text. */
  detectFailure?: (result: unknown) => string | null;
}

/**
 * Run one downstream call invoked from the UI (tool call, resource read, prompt
 * get) and record it to the activity log under via 'ui', exactly like proxied
 * calls. A thrown downstream error becomes a 502; a server that could not be
 * reached at all keeps the status the manager gave it, and is recorded too. A
 * workspace member's key records under its own instance.
 */
export async function runUiCall(
  manager: GatewayManager,
  key: InstanceKey,
  ctx: UiCallContext,
  run: (client: DownstreamClient) => Promise<unknown>,
): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = await manager.withClient(key, run);
    const failure = ctx.detectFailure?.(result) ?? null;
    manager.recordActivity(key, {
      at: new Date().toISOString(),
      via: 'ui',
      method: ctx.method,
      target: ctx.target,
      ok: failure === null,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      result,
      error: failure ?? undefined,
    });
    return result;
  } catch (cause) {
    manager.recordActivity(key, {
      at: new Date().toISOString(),
      via: 'ui',
      method: ctx.method,
      target: ctx.target,
      ok: false,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      error: errorDetailMessage(cause),
    });
    // The manager's own refusal — disabled, backed off, would not connect — already
    // carries its status. It is logged all the same, as it is for a proxied call:
    // "why did my call fail?" is what the Activity view is for.
    if (cause instanceof HttpError) {
      throw cause;
    }
    throw new HttpError(502, ctx.failLabel, errorMessage(cause), { cause });
  }
}
