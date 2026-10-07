import { CallVia } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { errorDetailMessage } from '../core/errors.ts';
import type { ActivityRecord } from './activity-log.ts';
import { emptyOnMissing } from './capability.ts';
import type { WithClient } from './downstream.ts';
import { recordedCall } from './recorded-call.ts';

export interface FanOutDeps {
  withClient: WithClient;
  recordActivity: (name: string, entry: ActivityRecord) => void;
}

/**
 * Fan a listing out over several downstream servers and concatenate what they
 * return. One server must not be able to fail the whole list: a server that
 * lacks the capability contributes nothing silently, and any other failure is
 * skipped but recorded to that server's activity log — that failure is exactly
 * the "why doesn't my server show up here?" case the Activity view is for.
 *
 * Routine successes are deliberately NOT recorded: list ops arrive on every
 * client (re)connect and every list_changed, and would evict the targeted calls
 * from the bounded per-server log.
 *
 * `describe` names the skipped server in the warning line, since the same
 * fan-out serves both the global aggregate and a workspace's members.
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
