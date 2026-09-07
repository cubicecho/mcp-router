import { createRegistryRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { HttpError } from '../../errors.ts';
import type { ApiDeps } from '../deps.ts';

/** Registry management and browsing, mounted at /api/registries. */
export function createRegistryRoutes({ store, registryClient }: ApiDeps): Router {
  const router = Router();

  const requireRegistry = (name: string) => {
    const registry = store.getRegistry(name);
    if (!registry) {
      throw new HttpError(404, `Unknown registry "${name}"`);
    }
    return registry;
  };

  router.get('/', (_req, res) => {
    res.json(store.getRegistries());
  });

  router.post('/', async (req, res) => {
    const registry = createRegistryRequestSchema.parse(req.body);
    await store.addRegistry(registry);
    res.status(201).json(registry);
  });

  router.delete('/:name', async (req, res) => {
    await store.removeRegistry(req.params.name);
    res.status(204).end();
  });

  router.get('/:name/servers', async (req, res) => {
    const registry = requireRegistry(req.params.name);
    const { search, cursor, limit } = req.query;
    const result = await registryClient.listServers(registry, {
      search: typeof search === 'string' ? search : undefined,
      cursor: typeof cursor === 'string' ? cursor : undefined,
      limit: typeof limit === 'string' ? Number(limit) || undefined : undefined,
    });
    res.json(result);
  });

  // Registry server names contain slashes (io.github.owner/repo): accept both
  // URL-encoded (%2F) and raw-slash forms via a named wildcard.
  router.get('/:name/servers/*serverName', async (req, res) => {
    const registry = requireRegistry(req.params.name);
    const segments = req.params.serverName as unknown as string[];
    const serverName = Array.isArray(segments) ? segments.join('/') : String(segments);
    const entry = await registryClient.getServer(registry, serverName);
    res.json(entry);
  });

  return router;
}
