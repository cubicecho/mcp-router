import {
  type McpConnection,
  McpPool,
  McpPoolError,
  type McpServerConfig,
  type McpServerState,
  type McpStatus,
  MINIMAL_CHILD_ENV,
  sameConnection,
} from '@cubicecho/agent-mcp-pool';
import type {
  ActivityEntry,
  ServerConfig,
  ServerRuntimeState,
  ServerStatus,
  SettingsFile,
  WorkspaceConfig,
  WorkspaceMember,
} from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Notification } from '@modelcontextprotocol/sdk/types.js';
import { GATEWAY_DEFAULTS } from '../defaults.ts';
import { HttpError } from '../errors.ts';
import { outboundFetch } from '../http-tuning.ts';
import { SERVER_VERSION } from '../version.ts';
import { ActivityLog, type ActivityRecord } from './activity-log.ts';
import type { Handshake } from './handshake.ts';
import { type InstanceKey, isBaseServerKey, workspaceInstanceKey } from './instance-key.ts';

/**
 * What the router keeps per managed instance, beside what the pool holds.
 *
 * The pool's own `state()` row is the connection: status, pid, start time, the
 * last error. None of this is — `config` is this repo's discriminated-union
 * shape rather than the flat row the pool was handed, and the call bookkeeping
 * is counted from proxied traffic the pool never sees.
 */
interface ServerMeta {
  config: ServerConfig;
  /** Tool count from the last proxied `tools/list`; cleared when the connection is restarted. */
  toolCount?: number;
  /**
   * What the downstream said at its last connect.
   *
   * Kept because the proxy `Server` that re-emits it is built when a client
   * initializes, which for an aggregate is long before most members have spawned.
   * Cleared with the config it was read under: a server whose command or env
   * changed is a different server, and stale guidance is worse than none.
   */
  handshake?: Handshake;
  /** Count of proxied calls recorded via recordActivity this process (reset on restart). */
  callCount: number;
  /** ISO timestamp of the most recent recorded call. */
  lastCalledAt?: string;
}

/**
 * Effective downstream config for a server as used by a workspace: the base
 * server config with per-workspace overrides applied. `env`/`headers` merge over
 * the base (workspace wins); `args` replaces the base stdio args and `url` replaces
 * the base streamable-http URL. The config keeps the base server's `name` so
 * aggregate tool namespacing is unaffected; its `enabled` reflects both the
 * workspace and the member being on.
 */
function resolveMemberConfig(base: ServerConfig, member: WorkspaceMember, workspace: WorkspaceConfig): ServerConfig {
  let transport = base.transport;
  if (transport.type === 'stdio' && member.args) {
    transport = { ...transport, args: member.args };
  } else if (transport.type === 'streamable-http' && (member.headers || member.url)) {
    transport = {
      ...transport,
      url: member.url ?? transport.url,
      headers: member.headers ? { ...transport.headers, ...member.headers } : transport.headers,
    };
  }
  return {
    ...base,
    enabled: workspace.enabled && (member.enabled ?? true),
    transport,
    env: member.env ? { ...base.env, ...member.env } : base.env,
  };
}

/**
 * The connection half of a server config as the pool wants it: one arm of the
 * pool's own `transport` union (pool 3.0), mapped from this repo's.
 *
 * `env` goes on the stdio arm only — it is a child's environment, and a remote
 * server has no child to hand it to.
 */
function toConnection(config: ServerConfig): McpConnection {
  const { transport } = config;
  if (transport.type === 'stdio') {
    return {
      transport: 'stdio',
      command: transport.command,
      args: transport.args,
      cwd: transport.cwd,
      env: config.env,
    };
  }
  return { transport: 'http', url: transport.url, headers: transport.headers };
}

/**
 * One managed instance as a pool row.
 *
 * The instance key is the row's id — a base server's name, or `w:<slug>:<server>`
 * — so a workspace member is an entry of its own with its own child, independent
 * of the base server's. `slug` is left unset and never read: the pool indexes no
 * tools here (see `indexTools` below) and `gateway/naming.ts` owns namespacing.
 */
function toPoolConfig(key: InstanceKey, config: ServerConfig, settings: SettingsFile): McpServerConfig {
  const stdio = config.transport.type === 'stdio';
  return {
    id: key,
    label: config.displayName ?? config.name,
    enabled: config.enabled,
    ...toConnection(config),
    // After the spread, not before: `connectTimeoutMs` is a field of `McpConnection`
    // as of pool 2.4.0, so a `toConnection` that ever fills it in would otherwise win
    // over the setting resolved here without anything failing to compile.
    //
    // Only a stdio child is worth reaping — it is a process holding memory. A
    // remote connection costs nothing to keep, and 0 is the pool's "never reap".
    // Resolved per row rather than passed to the pool once, because the global
    // default is a setting an operator can edit while the router is running.
    idleTimeoutMs: stdio ? (config.idleTimeoutMs ?? settings.idleTimeoutMs) : 0,
    // Same reason, and the pool re-reads it on every reconcile: bounds spawn plus the
    // MCP initialize handshake, so a server that starts and then never speaks fails the
    // request that woke it instead of holding it open forever. (The SDK's own 60s applies
    // to the initialize *request*, which such a server never gets far enough to answer.)
    connectTimeoutMs: settings.connectTimeoutMs,
  };
}

/**
 * True when two configs differ in a way that restarts the downstream connection.
 *
 * Asks the pool's own `sameConnection` — which decides the restart — about the
 * rows `toPoolConfig` would hand it, for the one piece of derived state the router
 * keeps across a reconcile: a tool count read from the old child is not true of a
 * new one. Only the connection fields matter, so the identity is left blank.
 */
function needsRestart(a: ServerConfig, b: ServerConfig): boolean {
  return !sameConnection(connectionRow(a), connectionRow(b));
}

function connectionRow(config: ServerConfig): McpServerConfig {
  return { id: '', label: '', enabled: config.enabled, ...toConnection(config) };
}

/** How the pool's connection status reads on this API. `disabled` and `idle` are both "no child, nothing wrong". */
const RUNTIME_STATE: Record<McpStatus, ServerRuntimeState> = {
  disabled: 'stopped',
  idle: 'stopped',
  connecting: 'starting',
  ready: 'running',
  error: 'error',
};

/**
 * One downstream MCP client per managed instance, over `@cubicecho/agent-mcp-pool`.
 *
 * The pool owns the lifecycle — reconciling rows against live children, lazy
 * spawn on first use, idle reap, crash backoff, and the notification relay. What
 * stays here is what the pool has no view of: this repo's config shape, the
 * workspace-scoped instance keys, the proxied-call activity log, and the HTTP
 * status codes the router answers a refusal with.
 */
export class GatewayManager {
  private readonly pool: McpPool;
  private readonly getSettings: () => SettingsFile;
  private readonly meta = new Map<InstanceKey, ServerMeta>();
  private readonly activity = new ActivityLog();

  constructor(getSettings: () => SettingsFile) {
    this.getSettings = getSettings;
    this.pool = new McpPool({
      clientName: 'mcp-router',
      // The other half of `clientInfo`, which is the whole of what a dialled server
      // learns about its caller. The pool used to fill this in with a constant
      // `0.1.0` (upstream agent-mcp-pool#60, fixed in 2.3.0), so downstream logs
      // named a version of nothing beside a name that was ours.
      clientVersion: SERVER_VERSION,
      // Spawn on the first request that needs a server rather than at boot: the
      // router carries dozens of installed servers, most idle most of the time.
      lazy: true,
      // The router proxies `tools/list` through from the client that asked and
      // never reads the pool's index, so draining it on every cold connect would
      // be a round trip per page in front of a user-facing request, for nobody.
      indexTools: false,
      // A stdio child gets this allowlist plus the server's own env, never the
      // router's full process.env — an MCP server is third-party code.
      childEnv: MINIMAL_CHILD_ENV,
      crashBackoffMs: GATEWAY_DEFAULTS.crashBackoffMs,
      // The pool's own keep-alive, at the idle time HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS names.
      fetch: outboundFetch(),
    });
  }

  /**
   * Sync managed instances with the given server + workspace configs: drop removed,
   * restart changed/disabled, add new. Base servers are keyed by name; each
   * workspace member that references an existing server gets its own isolated
   * downstream instance keyed `w:<slug>:<server>` with per-workspace overrides
   * applied, so a workspace can run a server independently of its global state.
   *
   * Awaiting it is what makes a write visible to the read that follows — the pool
   * serializes reconciles behind whatever it is already doing.
   */
  async reconcile(configs: ServerConfig[], workspaces: WorkspaceConfig[] = []): Promise<void> {
    const byName = new Map(configs.map((c) => [c.name, c]));
    const desired = new Map<string, ServerConfig>(byName);
    for (const workspace of workspaces) {
      for (const [serverName, member] of Object.entries(workspace.members)) {
        const base = byName.get(serverName);
        if (!base) {
          continue; // member references a server that no longer exists
        }
        desired.set(workspaceInstanceKey(workspace.slug, serverName), resolveMemberConfig(base, member, workspace));
      }
    }
    for (const [key, meta] of this.meta) {
      const next = desired.get(key);
      if (!next) {
        this.meta.delete(key);
        this.activity.clear(key);
        continue;
      }
      if (needsRestart(meta.config, next)) {
        // The pool is about to replace the child; a count and a handshake read
        // from the old one stop being true at the same moment.
        meta.toolCount = undefined;
        meta.handshake = undefined;
      }
      meta.config = next;
    }
    for (const [key, config] of desired) {
      if (this.meta.has(key) === false) {
        this.meta.set(key, { config, callCount: 0 });
      }
    }
    const settings = this.getSettings();
    await this.pool.sync([...desired].map(([key, config]) => toPoolConfig(key, config, settings)));
  }

  /**
   * Connect (spawning if needed) and return the downstream client for the given
   * instance key. Resets the idle timer. For base servers the key is the server
   * name; a workspace-scoped instance is keyed by {@link workspaceInstanceKey}.
   */
  async getClient(key: InstanceKey): Promise<Client> {
    let client: Client;
    try {
      client = await this.pool.client(key);
    } catch (cause) {
      this.fail(key, cause);
    }
    this.observe(key, client);
    return client;
  }

  /**
   * Keep what the downstream said about itself in the handshake `client` came from.
   *
   * Read on every use rather than only on the connects: the SDK kept these from
   * the initialize result, so they are field accesses, and there is no event to
   * hang them off — the pool reaps, respawns and redials on its own, and each of
   * those is a fresh handshake that may say something new.
   */
  private observe(key: InstanceKey, client: Client): void {
    const meta = this.meta.get(key);
    if (meta) {
      meta.handshake = { instructions: client.getInstructions(), capabilities: client.getServerCapabilities() };
    }
  }

  /**
   * Run one downstream request against the instance's client, on a fresh
   * connection if the one it had turns out to hold a session the downstream has
   * dropped.
   *
   * The redial is the pool's (`McpPool.use`): a remote server that restarts or
   * reclaims a session answers every later request `404`, or `400` to a client
   * that joined while it was stateless, without closing anything — so the row
   * stays `ready`, a remote row is never idle-reaped, and an aggregate quietly
   * lists its other members without it. Both are refusals before dispatch, which
   * is what makes the second attempt safe for a `tools/call`.
   *
   * @param run The request. Called a second time, with the new client, after a redial.
   */
  async withClient<T>(key: InstanceKey, run: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await this.pool.use(key, (client) => {
        this.observe(key, client);
        return run(client);
      });
    } catch (cause) {
      // Only the pool's own refusals are rewritten; whatever `run` rejected with is the caller's.
      this.fail(key, cause);
    }
  }

  /**
   * What the downstream said at its last connect; empty if it has not connected
   * in this process.
   *
   * Deliberately does not connect: the aggregate endpoint asks this for every
   * member while a client is initializing, and spawning a dozen children to
   * write a preamble the session may never act on is not a trade worth making.
   */
  handshake(key: InstanceKey): Handshake {
    return this.meta.get(key)?.handshake ?? {};
  }

  /**
   * Drop an instance's connection and dial it again.
   *
   * `stop` rather than `reconnect`, though both close the child: `stop` leaves
   * the row idle with its `error`/`failedAt` cleared, so the `getClient` below is
   * the dial, and a restart that fails reports as a 502 carrying the child's
   * stderr. `reconnect` dials the child itself (pool 2.2.0), which lands a failed
   * restart inside a backoff it started a millisecond earlier — the same call
   * would then answer 503 "crashed recently", naming a crash the operator just
   * asked to be retried. Clearing that backoff is what pressing Restart on a
   * crash-looping server is for.
   */
  async restart(key: InstanceKey): Promise<Client> {
    await this.pool.stop(key);
    return this.getClient(key);
  }

  /**
   * Re-throw one of the pool's refusals as the status this API answers it with.
   *
   * The wording stays the router's own: these strings are part of the REST
   * contract and are read by the UI, while the pool's are written for an agent.
   * `backoff` and `connect-failed` are the pair worth keeping apart — the first
   * means the pool declined to dial, the second that it dialled and could not.
   */
  private fail(key: InstanceKey, cause: unknown): never {
    const isPoolError = cause instanceof McpPoolError;
    if (isPoolError === false) {
      throw cause;
    }
    const name = this.meta.get(key)?.config.name ?? key;
    switch (cause.code) {
      case 'unknown-server':
        throw new HttpError(404, `Unknown server "${name}"`, undefined, { cause });
      case 'disabled':
        throw new HttpError(404, `Server "${name}" is disabled`, undefined, { cause });
      case 'backoff':
        throw new HttpError(503, `Server "${name}" crashed recently; retrying is backed off`, cause.detail, { cause });
      default:
        throw new HttpError(502, `Failed to connect to server "${name}"`, cause.detail, { cause });
    }
  }

  /** The pool's connection rows by instance key. Secrets are left out: nothing here reads the row's config. */
  private connectionState(): Map<InstanceKey, McpServerState> {
    return new Map(this.pool.state().map((row) => [row.id, row]));
  }

  status(key: InstanceKey): ServerStatus | undefined {
    const meta = this.meta.get(key);
    return meta ? toStatus(meta, this.connectionState().get(key)) : undefined;
  }

  statusAll(): ServerStatus[] {
    const state = this.connectionState();
    // Only base servers are exposed as "servers"; workspace-scoped instances are an internal detail.
    return [...this.meta]
      .filter(([key]) => isBaseServerKey(key))
      .map(([key, meta]) => toStatus(meta, state.get(key)))
      .sort((a, b) => a.config.name.localeCompare(b.config.name));
  }

  runningCount(): number {
    return this.pool.state().filter((row) => isBaseServerKey(row.id) && row.status === 'ready').length;
  }

  /**
   * Subscribe to downstream server→client notifications. The listener is called
   * with the instance key (base server name, or `w:<slug>:<server>` for a
   * workspace instance) and the raw notification. Returns an unsubscribe function.
   * Used by MCP sessions to relay list_changed / resources/updated / log
   * messages to their upstream client; survives downstream respawns because the
   * pool re-installs the handler on every connect.
   */
  onNotification(listener: (key: InstanceKey, notification: Notification) => void): () => void {
    return this.pool.onNotification(listener);
  }

  recordToolCount(key: InstanceKey, count: number): void {
    const meta = this.meta.get(key);
    if (meta) {
      meta.toolCount = count;
    }
  }

  /** Count a call against its instance and append it to the activity log. */
  recordActivity(key: InstanceKey, entry: ActivityRecord): void {
    // Only log for a currently-managed server: an in-flight call that completes
    // after the server was removed (reconcile drops it from both maps) must not
    // resurrect a stray activity entry that then leaks forever. A call that
    // completes right after a Clear legitimately re-populates the log — the
    // server still exists, so that is new activity, not a leak.
    const meta = this.meta.get(key);
    if (!meta) {
      return;
    }
    meta.callCount += 1;
    meta.lastCalledAt = entry.at;
    this.activity.record(key, entry);
  }

  /** Recorded activity for an instance, newest first. */
  getActivity(key: InstanceKey): ActivityEntry[] {
    return this.activity.newestFirst(key);
  }

  clearActivity(key: InstanceKey): void {
    this.activity.clear(key);
  }

  /** Names of all enabled base servers (for the global aggregate endpoint). */
  enabledNames(): string[] {
    return [...this.meta]
      .filter(([key, meta]) => isBaseServerKey(key) && meta.config.enabled)
      .map(([, meta]) => meta.config.name)
      .sort();
  }

  /** Close every downstream client / kill every child process. The manager stays usable. */
  async stopAll(): Promise<void> {
    await this.pool.shutdown();
  }
}

function toStatus(meta: ServerMeta, state: McpServerState | undefined): ServerStatus {
  return {
    config: meta.config,
    state: state ? RUNTIME_STATE[state.status] : 'stopped',
    pid: state?.pid,
    startedAt: state?.startedAt,
    // The pool reports "no error" as an empty string; this API reports it as absent.
    lastError: state?.error || undefined,
    toolCount: meta.toolCount,
    callCount: meta.callCount,
    lastCalledAt: meta.lastCalledAt,
  };
}
