import { createRegistryRequestSchema, HttpStatus } from '@mcp-router/shared';
import { Router } from 'express';
import { notFound } from '../../core/errors.ts';
import type { ApiDeps } from '../deps.ts';

/**
 * Builds the registry management and browsing routes, mounted at /api/registries.
 *
 * @param deps.store - Holds the configured registries.
 * @param deps.registryClient - Fetches a registry's server listings and entries.
 * @returns The router, with paths relative to /api/registries.
 */
export function createRegistryRoutes({ store, registryClient }: ApiDeps): Router {
  const router = Router();

  const requireRegistry = (name: string) => {
    const registry = store.getRegistry(name);
    if (!registry) {
      throw notFound(`Unknown registry "${name}"`);
    }
    return registry;
  };

  router.get('/', (_req, res) => {
    res.json(store.getRegistries());
  });

  router.post('/', async (req, res) => {
    const registry = createRegistryRequestSchema.parse(req.body);
    await store.addRegistry(registry);
    res.status(HttpStatus.Created).json(registry);
  });

  router.delete('/:name', async (req, res) => {
    await store.removeRegistry(req.params.name);
    res.status(HttpStatus.NoContent).end();
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
    const segments: unknown = req.params.serverName;
    const serverName = Array.isArray(segments) ? segments.join('/') : String(segments);
    const entry = await registryClient.getServer(registry, serverName);
    res.json(entry);
  });

  return router;
}
