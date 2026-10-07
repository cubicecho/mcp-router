import { CallVia } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { errorDetailMessage } from '../core/errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import { emptyOnMissing } from './capability.ts';
import type { WithClient } from './downstream.ts';
import { recordedCall } from './recorded-call.ts';

/** What a fan-out needs: a way to reach each server, and its activity log. */
export interface FanOutDeps {
  withClient: WithClient;
  /** Writes an entry to the named server's activity log. */
  recordActivity: (name: string, entry: ActivityRecord) => void;
}

/**
 * Fan a listing out over several downstream servers and concatenate what they return.
 *
 * @typeParam T - The listed item.
 * @param names - The servers to ask, all at once; the result keeps this order.
 * @param method - The MCP method, as recorded in the activity log.
 * @param deps - Reaches each server and records its failures.
 * @param fn - Lists one server's items.
 * @param [describe] - Names a skipped server in the warning line.
 * @returns Every server's items. Never rejects for one server: a failing one contributes nothing.
 *
 * @remarks
 * A server that lacks the capability is skipped silently; any other failure is logged and recorded to that server's
 * activity log. Successes are not recorded: list ops arrive on every client (re)connect and every list_changed, and
 * would evict the targeted calls from the bounded log.
 */
export async function collectFrom<T>(
  names: readonly string[],
  method: string,
  deps: FanOutDeps,
  fn: (client: Client, name: string) => Promise<T[]>,
  describe: (name: string) => string = (name) => `server "${name}" in aggregate`,
): Promise<T[]> {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const listed = await recordedCall(
          (entry) => deps.recordActivity(name, entry),
          { via: CallVia.Aggregate, method, failuresOnly: true },
          () => emptyOnMissing(() => deps.withClient(name, (client) => fn(client, name))),
        );
        return listed ?? [];
      } catch (err) {
        console.warn(`[gateway] skipping ${describe(name)}: ${errorDetailMessage(err)}`);
        return [];
      }
    }),
  );
  return results.flat();
}
