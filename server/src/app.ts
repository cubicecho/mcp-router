import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { errorMiddleware } from './api/error-middleware.ts';
import { createApiRouter } from './api/router.ts';
import { createAuthMiddleware, createOriginMiddleware, effectiveAuth } from './auth.ts';
import type { ConfigStore } from './config/store.ts';
import { HTTP_DEFAULTS } from './defaults.ts';
import type { GatewayManager } from './gateway/manager.ts';
import { createMcpRouter } from './gateway/routes.ts';
import { RegistryClient } from './registry/client.ts';

export interface AppDeps {
  store: ConfigStore;
  manager: GatewayManager;
  registryClient?: RegistryClient;
  /** Override for tests; defaults to <repo>/app/dist. */
  appDistDir?: string;
}

/** Build the Express app (separate from listen() so tests can drive it with supertest). */
export function buildApp(deps: AppDeps): express.Express {
  const { store, manager } = deps;
  const registryClient = deps.registryClient ?? new RegistryClient();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: HTTP_DEFAULTS.bodyLimit }));

  const auth = createAuthMiddleware(() => effectiveAuth(store.getSettings()));

  // Origin check first so a DNS-rebound browser request is rejected regardless of the bearer token
  // (which it cannot read anyway) — the one guard that still applies when SECURE_LOCAL_NET drops auth.
  const originGuard = createOriginMiddleware(() => store.getSettings().allowedOrigins);

  app.use('/api', auth, createApiRouter({ store, manager, registryClient, dataDir: store.dataDir }));
  app.use('/mcp', originGuard, auth, createMcpRouter({ store, manager }));

  // Production: serve the built web UI with an SPA fallback for non-API GETs.
  const appDist = deps.appDistDir ?? path.resolve(import.meta.dirname, '../../app/dist');
  if (existsSync(appDist)) {
    app.use(express.static(appDist));
    app.use((req, res, next) => {
      const isBackendPath = req.path.startsWith('/api') || req.path.startsWith('/mcp');
      if (req.method === 'GET' && isBackendPath === false) {
        res.sendFile(path.join(appDist, 'index.html'));
        return;
      }
      next();
    });
  }

  app.use(errorMiddleware);
  return app;
}
