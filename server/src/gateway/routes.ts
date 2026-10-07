import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { notFound, sendError } from '../core/errors.ts';
import { createAggregateServer } from './aggregate-proxy.ts';
import { createProxyServer } from './direct-proxy.ts';
import {
  type EndpointScope,
  globalScope,
  relayNotifications,
  scopedDeps,
  scopedInstructions,
  workspaceScope,
} from './endpoint-scope.ts';
import type { Handshake } from './handshake.ts';
import type { GatewayManager } from './manager.ts';
import { enabledMembers } from './members.ts';
import { pushNotification } from './notifications.ts';
import { SessionRegistry } from './session-registry.ts';

/** What the /mcp endpoints are built over. */
export interface McpRouterDeps {
  store: ConfigStore;
  manager: GatewayManager;
}

/**
 * Builds the streamable-HTTP MCP endpoints, in stateful mode: `/`, `/w/:slug` and `/:name`.
 *
 * @param deps - The store that says what exists and is enabled, and the manager that reaches it.
 * @returns The router, with paths relative to /mcp and a session registry of its own.
 *
 * @remarks
 * The initialize request mints a session (its own proxy Server + transport), reused across the session's later
 * POST/GET(SSE)/DELETE requests. A long-lived session is what lets downstream notifications (list_changed,
 * resources/updated, log messages) reach the client over its GET SSE stream.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store, manager } = deps;
  const router = Router();
  const sessions = new SessionRegistry(() => store.getSettings());
  const resume = (req: Request, res: Response): Promise<boolean> => sessions.resume(req, res);
  const start: SessionRegistry['start'] = (req, res, buildServer, wire) => sessions.start(req, res, buildServer, wire);

  const everyServer = globalScope(manager);

  /**
   * Reads what a 1:1 session re-emits from the downstream's own handshake, connecting first to get it.
   *
   * @param name - The server to connect.
   * @returns The handshake; empty, never a rejection, when the server will not connect.
   *
   * @remarks
   * The client asked for exactly this server, so the spawn is one the session was going to pay anyway. A downstream
   * that will not connect still gets its session: the failure belongs on the first request that needs the server,
   * where it carries its own status and the child's stderr, not on initialize.
   */
  const connectedHandshake = async (name: string): Promise<Handshake> => {
    await manager.getClient(name).catch(() => {});
    return manager.handshake(name);
  };

  /**
   * Start an aggregate session over everything the scope exposes.
   *
   * @param req - The initialize request; anything else is answered 400.
   * @param res - The response the session answers on.
   * @param scope - The servers the session merges, and the instance each reaches.
   */
  const startAggregate = (req: Request, res: Response, scope: EndpointScope): Promise<void> =>
    start(
      req,
      res,
      () => createAggregateServer(scopedDeps(manager, scope), scopedInstructions(manager, scope)),
      (server) => relayNotifications(manager, scope, server),
    );

  router.all('/', async (req, res) => {
    if (await resume(req, res)) {
      return;
    }
    await startAggregate(req, res, everyServer);
  });

  // Custom aggregate for a workspace: only its enabled members that still exist, run
  // as workspace-scoped downstream instances. Registered before '/:name' so the two
  // path segments never fall through to the per-server route.
  router.all('/w/:slug', async (req, res) => {
    if (await resume(req, res)) {
      return;
    }
    const slug = req.params.slug;
    const workspace = store.getWorkspace(slug);
    if (!workspace || workspace.enabled === false) {
      sendError(res, notFound(`Unknown workspace "${slug}"`));
      return;
    }
    // Read on every call: a session outlives config edits, and a workspace
    // deleted or disabled mid-session exposes nothing.
    const memberNames = (): string[] => {
      const current = store.getWorkspace(slug);
      return current?.enabled ? enabledMembers(current, store) : [];
    };
    await startAggregate(req, res, workspaceScope(slug, memberNames));
  });

  router.all('/:name', async (req, res) => {
    if (await resume(req, res)) {
      return;
    }
    const name = req.params.name;
    const config = store.getServer(name);
    if (!config || config.enabled === false) {
      sendError(res, notFound(`Unknown server "${name}"`));
      return;
    }
    await start(
      req,
      res,
      async () => createProxyServer(name, scopedDeps(manager, everyServer), await connectedHandshake(name)),
      // 1:1 endpoint: no namespacing, forward the owning server's notifications as-is.
      (server) =>
        manager.onNotification((key, notification) => {
          if (key === name) {
            pushNotification(server, notification);
          }
        }),
    );
  });

  return router;
}
