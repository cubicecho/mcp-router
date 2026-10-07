import { randomUUID } from 'node:crypto';
import type { SettingsFile } from '@mcp-router/shared';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { GATEWAY_DEFAULTS } from '../defaults.ts';
import { badInput, notFound, sendError } from '../errors.ts';
import { BoundedEventStore } from './event-store.ts';

/** Wire a session's proxy Server to relay downstream notifications; returns an unsubscribe. */
export type WireRelay = (server: Server) => () => void;

/** One client's stateful connection to an endpoint, with a last-touched clock for idle reclamation. */
interface Session {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
  /**
   * GET SSE streams the client is holding open on this session right now.
   *
   * A held stream is the client saying it is still here: an SDK client opens one right after
   * initialize and keeps it for the life of the connection, so a session in the middle of a
   * long lull between tool calls is not abandoned, however long ago its last POST was.
   */
  openStreams: number;
}

const sessionId = (req: Request): string | undefined => {
  const raw = req.headers['mcp-session-id'];
  return Array.isArray(raw) ? raw[0] : raw;
};

/**
 * The live sessions of every endpoint, by MCP session id: resumes a request onto its session,
 * starts one for an initialize request, and reclaims the idle and the excess.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly settings: () => Pick<SettingsFile, 'sessionIdleTimeoutMs' | 'maxSessions'>;

  /** @param settings - Read on every request, so an edited TTL or cap applies without a restart. */
  constructor(settings: () => Pick<SettingsFile, 'sessionIdleTimeoutMs' | 'maxSessions'>) {
    this.settings = settings;
  }

  /** Drop and close a session, removing it from the map up front so a racing request can't reuse it. */
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
   * Reclaim sessions idle past the configured TTL. Run opportunistically on every request
   * rather than on a timer, so there is no background handle to tear down (important for tests
   * and clean shutdown). Idleness is measured from the last request on the session, or from when
   * its last GET SSE stream closed, and a session holding a stream open is never idle.
   *
   * That exemption is not a nicety. The SDK's client transport does not re-initialize on a 404 —
   * it keeps the dead session id and fails every later call with it — so reclaiming a session
   * whose client is merely between tool calls breaks that client until it is reconnected by hand.
   * A dead peer's stream still closes (TCP keepalive is armed on it below), and `maxSessions`
   * bounds whatever is left.
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

  /** Route a request that carries a session id to its existing transport. Returns false if there is none. */
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
   * `buildServer` may be async because a proxy Server's `instructions` are the downstream's own,
   * and reading them can mean connecting first. It runs after the initialize check, so a
   * malformed request never spawns anything.
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
