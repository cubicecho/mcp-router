import type { ActivityEntry } from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { errorDetailMessage } from '../errors.ts';
import { lacksCapability } from './capability.ts';

export interface FanOutDeps {
  getClient: (name: string) => Promise<Client>;
  recordActivity: (name: string, entry: Omit<ActivityEntry, 'id'>) => void;
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
      const startedAt = Date.now();
      try {
        return await fn(await deps.getClient(name), name);
      } catch (err) {
        if (!lacksCapability(err)) {
          console.warn(`Skipping ${describe(name)}: ${errorDetailMessage(err)}`);
          deps.recordActivity(name, {
            at: new Date().toISOString(),
            via: 'aggregate',
            method,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: errorDetailMessage(err),
          });
        }
        return [];
      }
    }),
  );
  return results.flat();
}
