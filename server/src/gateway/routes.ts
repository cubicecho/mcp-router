import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { BoundedEventStore } from './event-store.ts';
import type { GatewayManager } from './manager.ts';
import { projectInstanceKey } from './manager.ts';
import { namespaceNotification, pushNotification } from './notifications.ts';
import { createAggregateServer, createProxyServer } from './proxy.ts';

export interface McpRouterDeps {
  store: ConfigStore;
  manager: GatewayManager;
}

/** Wire a session's proxy Server to relay downstream notifications; returns an unsubscribe. */
type WireRelay = (server: Server) => () => void;

/**
 * Streamable-HTTP MCP endpoints in stateful mode: the initialize request mints
 * a session (its own proxy Server + transport), kept in a map and reused across
 * the session's subsequent POST/GET(SSE)/DELETE requests. A long-lived session
 * is what lets downstream notifications (list_changed, resources/updated, log
 * messages) reach the client over its GET SSE stream.
 */
export function createMcpRouter(deps: McpRouterDeps): Router {
  const { store, manager } = deps;
  const router = Router();
  /** Live sessions by MCP session id, with a last-touched clock for idle reclamation. */
  interface Session {
    transport: StreamableHTTPServerTransport;
    lastActivity: number;
  }
  const sessions = new Map<string, Session>();

  const sessionId = (req: Request): string | undefined => {
    const raw = req.headers['mcp-session-id'];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  /** Drop and close a session, removing it from the map up front so a racing request can't reuse it. */
  const drop = (id: string): void => {
    const session = sessions.get(id);
    if (!session) {
      return;
    }
    sessions.delete(id);
    // close() chains our onclose (which unwires the notification relay); the map delete above
    // makes its own sessions.delete a harmless no-op.
    void session.transport.close();
  };

  /**
   * Reclaim sessions idle past the configured TTL. Run opportunistically on every request
   * rather than on a timer, so there is no background handle to tear down (important for tests
   * and clean shutdown). Idleness is measured from the last request on the session — a client
   * holding only a quiet GET SSE stream is eventually reclaimed and re-initializes on its next call.
   */
  const sweepIdle = (): void => {
    const ttl = store.getSettings().sessionIdleTimeoutMs;
    const cutoff = Date.now() - ttl;
    for (const [id, session] of sessions) {
      if (session.lastActivity < cutoff) {
        drop(id);
      }
    }
  };

  /** Evict least-recently-active sessions until there is room below the cap for one more. */
  const enforceCap = (): void => {
    const max = store.getSettings().maxSessions;
    const overflow = sessions.size - max + 1; // +1 leaves room for the incoming session
    if (overflow <= 0) {
      return;
    }
    const oldestFirst = [...sessions.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
    for (const [id] of oldestFirst.slice(0, overflow)) {
      drop(id);
    }
  };

  /** Route a request that carries a session id to its existing transport. Returns false if there is none. */
  const resume = async (req: Request, res: Response): Promise<boolean> => {
    sweepIdle();
    const id = sessionId(req);
    if (!id) {
      return false;
    }
    const session = sessions.get(id);
    if (!session) {
      res.status(404).json({ error: `Unknown or expired MCP session "${id}"` });
      return true;
    }
    session.lastActivity = Date.now();
    await session.transport.handleRequest(req, res, req.body);
    return true;
  };

  /** Start a new session for an initialize request; anything else without a session id is a 400. */
  const start = async (req: Request, res: Response, buildServer: () => Server, wire: WireRelay): Promise<void> => {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'Missing or expired mcp-session-id' });
      return;
    }
    enforceCap();
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      // Per-session bounded buffer so a client whose GET SSE stream drops can reconnect
      // with Last-Event-ID and replay missed notifications; reclaimed with the session.
      eventStore: new BoundedEventStore(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, lastActivity: Date.now() });
      },
    });
    const unwire = wire(server);
    // Set before connect(): the SDK chains our onclose ahead of its own teardown.
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
      unwire();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const proxyDeps = {
    getClient: (name: string) => manager.getClient(name),
    recordToolCount: (name: string, count: number) => manager.recordToolCount(name, count),
    recordActivity: (name: string, entry: Parameters<GatewayManager['recordActivity']>[1]) =>
      manager.recordActivity(name, entry),
  };

  router.all('/', async (req, res) => {
    if (await resume(req, res)) {
      return;
    }
    const serverNames = () => manager.enabledNames();
    await start(
      req,
      res,
      () => createAggregateServer({ ...proxyDeps, serverNames }),
      (server) =>
        manager.onNotification((key, notification) => {
          // enabledNames() lists only base keys, so project instances never match here.
          if (serverNames().includes(key)) {
            pushNotification(server, namespaceNotification(notification, key));
          }
        }),
    );
  });

  // Custom aggregate for a project: only its enabled members that still exist, run
  // as project-scoped downstream instances. Registered before '/:name' so the two
  // path segments never fall through to the per-server route.
  router.all('/p/:slug', async (req, res) => {
    if (await resume(req, res)) {
      return;
    }
    const slug = req.params.slug;
    const project = store.getProject(slug);
    if (!project || !project.enabled) {
      res.status(404).json({ error: `Unknown project "${slug}"` });
      return;
    }
    // Enabled members whose base server still exists, resolved fresh per request.
    const memberNames = (): string[] =>
      Object.entries(project.members)
        .filter(([name, member]) => (member.enabled ?? true) && store.getServer(name))
        .map(([name]) => name)
        .sort();
    const projectDeps = {
      getClient: (name: string) => manager.getClientForProject(slug, name),
      recordToolCount: (name: string, count: number) => manager.recordToolCount(projectInstanceKey(slug, name), count),
      // Activity is logged under the project-scoped instance key so it surfaces in
      // the project's own Activity view, isolated from the base server's log.
      recordActivity: (name: string, entry: Parameters<GatewayManager['recordActivity']>[1]) =>
        manager.recordActivity(projectInstanceKey(slug, name), entry),
      serverNames: memberNames,
    };
    await start(
      req,
      res,
      () => createAggregateServer(projectDeps),
      (server) =>
        manager.onNotification((key, notification) => {
          // Downstream notifications arrive under the project instance key.
          for (const name of memberNames()) {
            if (key === projectInstanceKey(slug, name)) {
              pushNotification(server, namespaceNotification(notification, name));
              return;
            }
          }
        }),
    );
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
      () => createProxyServer(name, proxyDeps),
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
