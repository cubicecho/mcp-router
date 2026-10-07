import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Health } from '@mcp-router/shared';
import express from 'express';
import { errorMiddleware } from '../api/error-middleware.ts';
import { createApiRouter } from '../api/router.ts';
import { createAuthMiddleware, createOriginMiddleware, effectiveAuth } from '../auth/middleware.ts';
import type { ConfigStore } from '../config/store.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { SERVER_VERSION } from '../core/version.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import { createMcpRouter } from '../gateway/routes.ts';
import { RegistryClient } from '../registry/client.ts';

/** What the Express app is built over. */
export interface AppDeps {
  store: ConfigStore;
  manager: GatewayManager;
  /** Override for tests; a client over the global fetch is made when absent. */
  registryClient?: RegistryClient;
  /** Override for tests; `<repo>/app/dist` when absent. */
  appDistDir?: string;
}

/**
 * Build the Express app (separate from listen() so tests can drive it with supertest).
 *
 * @param deps - The store and gateway, plus the test overrides.
 * @returns The app: /healthz, /api, /mcp, and the built web UI when its directory exists.
 */
export function createApp(deps: AppDeps): express.Express {
  const { store, manager } = deps;
  const registryClient = deps.registryClient ?? new RegistryClient();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: HTTP_DEFAULTS.bodyLimit }));

  const auth = createAuthMiddleware(() => effectiveAuth(store.getSettings()));

  // Origin check first so a DNS-rebound browser request is rejected regardless of the bearer token
  // (which it cannot read anyway) — the one guard that still applies when SECURE_LOCAL_NET drops auth.
  const originGuard = createOriginMiddleware(() => store.getSettings().allowedOrigins);

  // Before the auth middleware: Docker's healthcheck and a load balancer carry no token. It reads nothing the
  // router holds, so a healthy answer means only that the process is serving.
  app.get('/healthz', (_req, res) => {
    const health: Health = { ok: true, version: SERVER_VERSION };
    res.json(health);
  });

  app.use('/api', auth, createApiRouter({ store, manager, registryClient, dataDir: store.dataDir }));
  app.use('/mcp', originGuard, auth, createMcpRouter({ store, manager }));

  // Production: serve the built web UI with an SPA fallback for non-API GETs.
  const appDist = deps.appDistDir ?? path.resolve(import.meta.dirname, '../../../app/dist');
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
