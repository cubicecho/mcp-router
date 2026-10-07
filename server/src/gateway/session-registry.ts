import { randomUUID } from 'node:crypto';
import type { SettingsFile } from '@mcp-router/shared';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { GATEWAY_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound, sendError } from '../core/errors.ts';
import { BoundedEventStore } from './event-store.ts';

/** Wire a session's proxy Server to relay downstream notifications; returns an unsubscribe. */
export type WireRelay = (server: Server) => () => void;

/** One client's stateful connection to an endpoint, with a last-touched clock for idle reclamation. */
interface Session {
  transport: StreamableHTTPServerTransport;
  /** When the session last saw a request or lost a stream, in ms since the epoch. */
  lastActivity: number;
  /**
   * GET SSE streams the client is holding open on this session right now.
   *
   * @remarks
   * A held stream is the client saying it is still here: an SDK client opens one right after initialize and keeps it
   * for the life of the connection, so a session in a long lull between tool calls is not abandoned.
   */
  openStreams: number;
}

/**
 * Reads the MCP session id a request carries.
 *
 * @param req - The request.
 * @returns The `mcp-session-id` header (the first, if repeated), or undefined when there is none.
 */
const sessionId = (req: Request): string | undefined => {
  const raw = req.headers['mcp-session-id'];
  return Array.isArray(raw) ? raw[0] : raw;
};

/**
 * Holds the live sessions of every endpoint, by MCP session id.
 *
 * @remarks
 * It resumes a request onto its session, starts one for an initialize request, and reclaims the idle and the excess.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly settings: () => Pick<SettingsFile, 'sessionIdleTimeoutMs' | 'maxSessions'>;

  /**
   * Builds an empty registry.
   *
   * @param settings - Read on every request, so an edited TTL or cap applies without a restart.
   */
  constructor(settings: () => Pick<SettingsFile, 'sessionIdleTimeoutMs' | 'maxSessions'>) {
    this.settings = settings;
  }

  /**
   * Drop and close a session, removing it from the map up front so a racing request can't reuse it.
   *
   * @param id - The session id; an unknown one is a no-op.
   */
  private drop(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    this.sessions.delete(id);
    // close() chains our onclose (which unwires the notification relay); the map delete above
    // makes its own sessions.delete a harmless no-op.
    void session.transport.close();
  }

  /**
   * Reclaim sessions idle past the configured TTL; one holding a GET SSE stream open is never idle.
   *
   * @remarks
   * Run on every request rather than on a timer, so there is no background handle to tear down. The stream exemption
   * matters: the SDK's client transport does not re-initialize on a 404, so reclaiming a session whose client is
   * merely between tool calls breaks that client until it is reconnected by hand.
   */
  private sweepIdle(): void {
    const ttl = this.settings().sessionIdleTimeoutMs;
    const cutoff = Date.now() - ttl;
    for (const [id, session] of this.sessions) {
      if (session.openStreams === 0 && session.lastActivity < cutoff) {
        this.drop(id);
      }
    }
  }

  /** Evict least-recently-active sessions until there is room below the cap for one more. */
  private enforceCap(): void {
    const max = this.settings().maxSessions;
    const overflow = this.sessions.size - max + 1; // +1 leaves room for the incoming session
    if (overflow <= 0) {
      return;
    }
    const oldestFirst = [...this.sessions.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
    for (const [id] of oldestFirst.slice(0, overflow)) {
      this.drop(id);
    }
  }

  /**
   * Route a request that carries a session id to its existing transport.
   *
   * @param req - The request; a GET counts as a held stream until its response closes.
   * @param res - The response; answered 404 here when the id names no live session.
   * @returns False when the request carries no session id, so nothing was sent; true once it has been answered.
   */
  async resume(req: Request, res: Response): Promise<boolean> {
    this.sweepIdle();
    const id = sessionId(req);
    if (!id) {
      return false;
    }
    const session = this.sessions.get(id);
    if (!session) {
      sendError(res, notFound(`Unknown or expired MCP session "${id}"`));
      return true;
    }
    session.lastActivity = Date.now();
    if (req.method === 'GET') {
      session.openStreams += 1;
      // A client whose machine slept or dropped off the network never sends a FIN, and a quiet
      // stream never writes to find out — keepalive is what eventually closes it.
      req.socket.setKeepAlive(true, GATEWAY_DEFAULTS.streamKeepAliveMs);
      res.on('close', () => {
        session.openStreams -= 1;
        // Idleness starts when the client stopped listening, not when it last spoke.
        session.lastActivity = Date.now();
      });
    }
    await session.transport.handleRequest(req, res, req.body);
    return true;
  }

  /**
   * Start a new session for an initialize request; anything else without a session id is a 400.
   *
   * @param req - The request, with its JSON body already parsed.
   * @param res - The response the initialize is answered on.
   * @param buildServer - Makes the session's proxy Server; runs after the initialize check.
   * @param wire - Subscribes the server to downstream notifications; its unsubscribe runs when the session closes.
   *
   * @remarks
   * `buildServer` may be async because a proxy Server's `instructions` are the downstream's own, and reading them can
   * mean connecting first. Running it after the check means a malformed request never spawns anything.
   */
  async start(
    req: Request,
    res: Response,
    buildServer: () => Server | Promise<Server>,
    wire: WireRelay,
  ): Promise<void> {
    if (isInitializeRequest(req.body) === false) {
      sendError(res, badInput('Missing or expired mcp-session-id'));
      return;
    }
    this.enforceCap();
    const server = await buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      // Per-session bounded buffer so a client whose GET SSE stream drops can reconnect
      // with Last-Event-ID and replay missed notifications; reclaimed with the session.
      eventStore: new BoundedEventStore(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, lastActivity: Date.now(), openStreams: 0 });
      },
    });
    const unwire = wire(server);
    // Set before connect(): the SDK chains our onclose ahead of its own teardown.
    transport.onclose = () => {
      if (transport.sessionId) {
        this.sessions.delete(transport.sessionId);
      }
      unwire();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
