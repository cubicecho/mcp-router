import { type DiscoveryResponse, setDismissedRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { withDismissed } from '../../discovery/lan-servers.ts';
import type { ApiDeps } from '../deps.ts';

/**
 * Builds the endpoints for servers found on the local network: the list, and dismissing or restoring one.
 *
 * @param deps.store - Holds the dismissed keys and whether discovery is on.
 * @param deps.lanServers - The servers found so far.
 * @returns The router, with paths relative to /api/discovery.
 *
 * @remarks
 * Adding a found server is an ordinary `POST /api/servers` with its URL and a `discovered` marker.
 */
export function createDiscoveryRoutes({ store, lanServers }: ApiDeps): Router {
  const router = Router();

  const answer = (): DiscoveryResponse => ({
    enabled: store.getSettings().lanDiscovery,
    servers: lanServers.list(),
  });

  router.get('/', (_req, res) => {
    res.json(answer());
  });

  router.post('/dismissed', async (req, res) => {
    const { key, dismissed } = setDismissedRequestSchema.parse(req.body);
    await store.updateSettings({ lanDismissed: withDismissed(store.getSettings().lanDismissed, key, dismissed) });
    res.json(answer());
  });

  return router;
}
