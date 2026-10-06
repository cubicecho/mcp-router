import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
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

export interface McpRouterDeps {
  store: ConfigStore;
  manager: GatewayManager;
}

/**
 * Streamable-HTTP MCP endpoints in stateful mode: the initialize request mints
 * a session (its own proxy Server + transport), kept by the session registry and reused across
 * the session's subsequent POST/GET(SSE)/DELETE requests. A long-lived session
 * is what lets downstream notifications (list_changed, resources/updated, log
 * messages) reach the client over its GET SSE stream.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store, manager } = deps;
  const router = Router();
  const sessions = new SessionRegistry(() => store.getSettings());
  const resume = (req: Request, res: Response): Promise<boolean> => sessions.resume(req, res);
  const start: SessionRegistry['start'] = (req, res, buildServer, wire) => sessions.start(req, res, buildServer, wire);

  const everyServer = globalScope(manager);

  /**
   * What a 1:1 session re-emits from the downstream's own handshake, connecting first to get it.
   *
   * This endpoint is a client that asked for exactly this server, so the spawn it costs is one
   * the session was going to pay anyway. A downstream that will not connect still gets its
   * session, and falls back to advertising everything the proxy can relay: the failure belongs
   * on the first request that needs the server, where it carries its own status and the child's
   * stderr, not on initialize.
   */
  const connectedHandshake = async (name: string): Promise<Handshake> => {
    await manager.getClient(name).catch(() => {});
    return manager.handshake(name);
  };

  /** Start an aggregate session over everything the scope exposes. */
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
    if (!workspace || !workspace.enabled) {
      res.status(404).json({ error: `Unknown workspace "${slug}"` });
      return;
    }
    // Re-read the workspace on every call rather than closing over the snapshot
    // taken at initialize: a session outlives config edits, so a member added,
    // removed or disabled afterwards must be reflected on the next tools/list.
    // A workspace deleted or disabled mid-session simply exposes nothing.
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
    if (!config || !config.enabled) {
      res.status(404).json({ error: `Unknown server "${name}"` });
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
