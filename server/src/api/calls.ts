import { errorMessage, HttpError } from '../errors.ts';
import type { GatewayManager } from '../gateway/manager.ts';

/** A connected downstream client, as the gateway manager hands it out. */
export type DownstreamClient = Awaited<ReturnType<GatewayManager['getClient']>>;

/**
 * Connect (spawning if needed) for a listing/call endpoint. A missing server
 * surfaces as 404; any other connect failure as 502 with the downstream detail.
 */
export async function connect(manager: GatewayManager, name: string): Promise<DownstreamClient> {
  try {
    return await manager.getClient(name);
  } catch (cause) {
    if (cause instanceof HttpError && cause.status === 404) {
      throw cause;
    }
    const detail = cause instanceof HttpError ? (cause.detail ?? cause.message) : String(cause);
    throw new HttpError(502, `Failed to connect to server "${name}"`, detail, { cause });
  }
}

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
 * calls. A thrown downstream error becomes a 502. `name` is any managed
 * instance key, so a workspace member records under its own scoped instance.
 */
export async function runUiCall(
  manager: GatewayManager,
  name: string,
  ctx: UiCallContext,
  run: (client: DownstreamClient) => Promise<unknown>,
): Promise<unknown> {
  const client = await connect(manager, name);
  const startedAt = Date.now();
  try {
    const result = await run(client);
    const failure = ctx.detectFailure?.(result) ?? null;
    manager.recordActivity(name, {
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
    manager.recordActivity(name, {
      at: new Date().toISOString(),
      via: 'ui',
      method: ctx.method,
      target: ctx.target,
      ok: false,
      durationMs: Date.now() - startedAt,
      params: ctx.params,
      error: errorMessage(cause),
    });
    throw new HttpError(502, ctx.failLabel, errorMessage(cause), { cause });
  }
}
