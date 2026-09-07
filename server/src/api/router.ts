import { Router } from 'express';
import type { ApiDeps } from './deps.ts';
import { createRegistryRoutes } from './routes/registries.ts';
import { createServerRoutes } from './routes/servers.ts';
import { createSystemRoutes } from './routes/system.ts';
import { createWorkspaceRoutes } from './routes/workspaces.ts';

export type { ApiDeps } from './deps.ts';

/**
 * The REST API mounted at /api, assembled from one router per resource. Each
 * sub-router owns its own path prefix, so its routes are written relative to it.
 */
export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  router.use(createSystemRoutes(deps));
  router.use('/registries', createRegistryRoutes(deps));
  router.use('/servers', createServerRoutes(deps));
  router.use('/workspaces', createWorkspaceRoutes(deps));
  return router;
}
