import { existsSync } from 'node:fs';
import path from 'node:path';
import { discoveryMiddleware } from '@cubicecho/mcp-discovery';
import type { Health } from '@mcp-router/shared';
import express from 'express';
import type { AuthHost } from '../auth/auth-host.ts';
import { createApiKeyMiddleware, createCallerMiddleware, createOriginMiddleware } from '../auth/middleware.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { trustProxy } from '../config/env.ts';
import type { ConfigStore } from '../config/store.ts';
import { createContextFactory } from '../core/context.ts';
import { HTTP_DEFAULTS } from '../core/defaults.ts';
import { SERVER_VERSION } from '../core/version.ts';
import type { DB } from '../db/client.ts';
import { discoveryEndpoints } from '../discovery/endpoints.ts';
import { idleLanServers, type LanServers } from '../discovery/lan-servers.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import { createMcpRouter } from '../gateway/routes.ts';
import { createAdminMcpHandler } from '../graphql/admin-mcp.ts';
import { createSchema } from '../graphql/build-schema.ts';
import { createGraphQLHandler, GRAPHQL_PATH } from '../graphql/handler.ts';
import { createOAuthRoutes } from '../oauth/routes.ts';
import { OAuthService } from '../oauth/service.ts';
import { RegistryClient } from '../registry/client.ts';
import { errorMiddleware } from './error-middleware.ts';
import { mountSso, SSO_CALLBACK_PATH, SSO_START_PATH } from './sso.ts';

/** What the Express app is built over. */
export interface AppDeps {
  store: ConfigStore;
  manager: GatewayManager;
  /** Override for tests; a client over the global fetch is made when absent. */
  registryClient?: RegistryClient;
  /** Override for tests; `<repo>/app/dist` when absent. */
  appDistDir?: string;
  /** Remote-server sign-in; the one the manager was built with. A fresh one, wired to `manager`, when absent. */
  oauth?: OAuthService;
  /** The servers found on the local network; one that never watches when absent. */
  lanServers?: LanServers;
  /** The router's tables, the ones `store` reads: /graphql and /admin/mcp query and write them directly. */
  db: DB;
  /** Where the current better-auth instance is: sessions, API keys and the OIDC sign-in. */
  authHost: AuthHost;
  /**
   * Sign-in throttle.
   * @defaultValue `createRateLimiter()`
   */
  limiter?: RateLimiter;
}

/** The path the router's own management schema is served at as MCP tools. Beside /mcp, which proxies servers. */
export const ADMIN_MCP_PATH = '/admin/mcp';

/** The paths the backend answers under, which the SPA fallback never serves the UI's page for. */
const BACKEND_PATH_PREFIXES: readonly string[] = Object.freeze([
  GRAPHQL_PATH,
  ADMIN_MCP_PATH,
  '/mcp',
  '/oauth',
  SSO_START_PATH,
  SSO_CALLBACK_PATH,
]);

/**
 * Says whether a request path is a prefix's own path or one below it.
 *
 * @param requestPath - The request's path.
 * @param prefix - A backend path such as `/mcp`.
 * @returns true for `/mcp` and `/mcp/x`, false for `/mcpx`.
 */
function isUnder(requestPath: string, prefix: string): boolean {
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

/**
 * Build the Express app (separate from listen() so tests can drive it with supertest).
 *
 * @param deps - The store, the gateway and the auth host, plus the test overrides.
 * @returns The app: /healthz, the discovery documents, /oauth, the OIDC sign-in's two legs, /mcp, /graphql,
 * /admin/mcp, and the built web UI when its directory exists.
 */
export function createApp(deps: AppDeps): express.Express {
  const { store, manager, authHost } = deps;
  const limiter = deps.limiter ?? createRateLimiter();
  const registryClient = deps.registryClient ?? new RegistryClient();
  const oauth = deps.oauth ?? new OAuthService(store, { onChange: (name) => manager.resetServer(name) });
  const app = express();
  app.disable('x-powered-by');
  // The sign-in throttle keys on req.ip, which is the real client only when this matches the proxy in front.
  app.set('trust proxy', trustProxy());
  app.use(express.json({ limit: HTTP_DEFAULTS.bodyLimit }));

  // Origin check first, so a DNS-rebound browser request is rejected whatever credential it carries.
  const originGuard = createOriginMiddleware(() => store.getSettings().allowedOrigins);

  // Before any credential check: Docker's healthcheck and a load balancer carry no key. It reads nothing the
  // router holds, so a healthy answer means only that the process is serving.
  app.get('/healthz', (_req, res) => {
    const health: Health = { ok: true, version: SERVER_VERSION };
    res.json(health);
  });

  // Also public: the AI Catalog and each endpoint's Server Card name the endpoints and say a key is needed, but never
  // carry one.
  app.use(discoveryMiddleware(() => discoveryEndpoints(store)));

  // Also public: a server's login fetches the client metadata and sends the browser back with no key. The callback is
  // held to the `state` of a sign-in started through `startServerOAuth` instead.
  app.use(createOAuthRoutes({ store, oauth }));

  // The two legs of the operator's OIDC sign-in a browser is redirected through. Mounted always: a provider can be
  // paired while the router runs.
  mountSso(app, authHost);

  const lanServers = deps.lanServers ?? idleLanServers();
  // The proxied servers take an API key only, in Authorization: Bearer or x-api-key.
  app.use('/mcp', originGuard, createApiKeyMiddleware(authHost), createMcpRouter({ store, manager }));

  // The management API, as GraphQL for the UI and as MCP tools for agents, under the same body cap (the express.json
  // above). /graphql is open to nobody too, for signing in: permissions refuse everything else. /admin/mcp needs a key
  // or a session up front, so an MCP client is told so with a 401.
  const { schema } = createSchema(deps.db);
  const contextDeps = { store, manager, registryClient, dataDir: store.dataDir, oauth, lanServers };
  const contextFor = createContextFactory({
    ...contextDeps,
    db: deps.db,
    startedAt: Date.now(),
    authHost,
    limiter,
  });
  const yoga = createGraphQLHandler(schema, contextFor);
  app.all(GRAPHQL_PATH, (req, res) => yoga(req, res));
  app.all(ADMIN_MCP_PATH, originGuard, createCallerMiddleware(authHost), createAdminMcpHandler(schema, contextFor));

  // Production: serve the built web UI, with an SPA fallback for every GET the backend does not answer.
  const appDist = deps.appDistDir ?? path.resolve(import.meta.dirname, '../../../app/dist');
  if (existsSync(appDist)) {
    app.use(express.static(appDist));
    app.use((req, res, next) => {
      const isBackendPath = BACKEND_PATH_PREFIXES.some((prefix) => isUnder(req.path, prefix));
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
