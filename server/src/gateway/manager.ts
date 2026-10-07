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
import {
  type ActivityEntry,
  type ServerConfig,
  ServerRuntimeState,
  type ServerStatus,
  type SettingsFile,
  TRANSPORT_STDIO,
  TRANSPORT_STREAMABLE_HTTP,
  type WorkspaceConfig,
  type WorkspaceMember,
} from '@mcp-router/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Notification } from '@modelcontextprotocol/sdk/types.js';
import { GATEWAY_DEFAULTS } from '../core/defaults.ts';
import { notFound, unavailable, upstreamFailed } from '../core/errors.ts';
import { SERVER_VERSION } from '../core/version.ts';
import { outboundFetch } from '../http/tuning.ts';
import { ActivityLog, type ActivityRecord } from './activity-log.ts';
import type { Handshake } from './handshake.ts';
import { type InstanceKey, isBaseServerKey, workspaceInstanceKey } from './instance-key.ts';

/**
 * What the router keeps per managed instance, beside what the pool holds.
 *
 * @remarks
 * The pool's own `state()` row is the connection: status, pid, start time, the last error. None of this is: `config`
 * is this repo's discriminated-union shape rather than the flat row the pool was handed, and the call bookkeeping is
 * counted from proxied traffic the pool never sees.
 */
interface ServerMeta {
  config: ServerConfig;
  /** Tool count from the last proxied `tools/list`; cleared when the connection is restarted. */
  toolCount?: number;
  /**
   * What the downstream said at its last connect.
   *
   * @remarks
   * Kept because the proxy `Server` that re-emits it is built when a client initializes, which for an aggregate is
   * long before most members have spawned. Cleared with the config it was read under: a server whose command or env
   * changed is a different server, and stale guidance is worse than none.
   */
  handshake?: Handshake;
  /** Count of proxied calls recorded via recordActivity this process (reset on restart). */
  callCount: number;
  /** ISO timestamp of the most recent recorded call. */
  lastCalledAt?: string;
}

/**
 * Resolves the downstream config for a server as used by a workspace: the base config with the overrides applied.
 *
 * @param base - The server's own config; not mutated.
 * @param member - The overrides: `env` and `headers` merge over the base, `args` and `url` replace it.
 * @param workspace - The owning workspace; when it is disabled, so is the result.
 * @returns A config under the base server's `name`, enabled only when both the workspace and the member are.
 *
 * @remarks
 * Keeping the base `name` leaves aggregate tool namespacing unaffected. `args` applies to a stdio server only, and
 * `url` and `headers` to a streamable-http one.
 */
function resolveMemberConfig(base: ServerConfig, member: WorkspaceMember, workspace: WorkspaceConfig): ServerConfig {
  let transport = base.transport;
  if (transport.type === TRANSPORT_STDIO && member.args) {
    transport = { ...transport, args: member.args };
  } else if (transport.type === TRANSPORT_STREAMABLE_HTTP && (member.headers || member.url)) {
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
 * Maps the connection half of a server config onto one arm of the pool's own `transport` union (pool 3.0).
 *
 * @param config - The server config.
 * @returns The stdio or http connection fields.
 *
 * @remarks
 * `env` goes on the stdio arm only: it is a child's environment, and a remote server has no child to hand it to.
 */
function toConnection(config: ServerConfig): McpConnection {
  const { transport } = config;
  if (transport.type === TRANSPORT_STDIO) {
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
 * Builds the pool row for one managed instance.
 *
 * @param key - Becomes the row's id: a base server's name, or `w:<slug>:<server>`.
 * @param config - The instance's effective config.
 * @param settings - Supplies the connect timeout, and the idle timeout a stdio server without its own falls back to.
 * @returns The row. A remote server's idle timeout is 0, the pool's "never".
 *
 * @remarks
 * Keying by instance makes a workspace member an entry of its own with its own child, independent of the base
 * server's. `slug` is left unset and never read: the pool indexes no tools here (see `indexTools` below) and
 * `gateway/naming.ts` owns namespacing.
 */
function toPoolConfig(key: InstanceKey, config: ServerConfig, settings: SettingsFile): McpServerConfig {
  const stdio = config.transport.type === TRANSPORT_STDIO;
  return {
    id: key,
    label: config.displayName ?? config.name,
    enabled: config.enabled,
    ...toConnection(config),
    // After the spread, so a `toConnection` that sets either timeout cannot win.
    // Only a stdio child is reaped (0 is the pool's "never"). Resolved per row
    // because the default is a setting that changes while the router runs.
    idleTimeoutMs: stdio ? (config.idleTimeoutMs ?? settings.idleTimeoutMs) : 0,
    // Bounds spawn plus the initialize handshake, so a server that starts and
    // never speaks fails the request that woke it.
    connectTimeoutMs: settings.connectTimeoutMs,
  };
}

/**
 * Tells whether two configs differ in a way that restarts the downstream connection.
 *
 * @param a - The config in force.
 * @param b - The config about to replace it.
 * @returns True when the pool's own `sameConnection`, which decides the restart, says the two differ.
 *
 * @remarks
 * Asked so the state read from the old child (tool count, handshake) is dropped when the pool replaces it.
 */
function needsRestart(a: ServerConfig, b: ServerConfig): boolean {
  return !sameConnection(connectionRow(a), connectionRow(b));
}

/**
 * Builds the row `sameConnection` compares: the connection fields and `enabled`, with the identity left blank.
 *
 * @param config - The server config.
 * @returns A pool row with an empty id and label.
 */
function connectionRow(config: ServerConfig): McpServerConfig {
  return { id: '', label: '', enabled: config.enabled, ...toConnection(config) };
}

/** How the pool's connection status reads on this API. `disabled` and `idle` are both "no child, nothing wrong". */
const RUNTIME_STATE: Record<McpStatus, ServerRuntimeState> = {
  disabled: ServerRuntimeState.Stopped,
  idle: ServerRuntimeState.Stopped,
  connecting: ServerRuntimeState.Starting,
  ready: ServerRuntimeState.Running,
  error: ServerRuntimeState.Error,
};

/**
 * One downstream MCP client per managed instance, over `@cubicecho/agent-mcp-pool`.
 *
 * @remarks
 * The pool owns the lifecycle: reconciling rows against live children, lazy spawn on first use, idle reap, crash
 * backoff, and the notification relay. What stays here is what the pool has no view of: this repo's config shape, the
 * workspace-scoped instance keys, the proxied-call activity log, and the HTTP status codes a refusal is answered with.
 */
export class GatewayManager {
  private readonly pool: McpPool;
  private readonly getSettings: () => SettingsFile;
  private readonly meta = new Map<InstanceKey, ServerMeta>();
  private readonly activity = new ActivityLog();

  /**
   * Builds a manager with no instances; `reconcile` gives it some.
   *
   * @param getSettings - Read on every reconcile, for the timeouts that can change while the router runs.
   */
  constructor(getSettings: () => SettingsFile) {
    this.getSettings = getSettings;
    this.pool = new McpPool({
      clientName: 'mcp-router',
      // With `clientName`, all a dialled server learns about its caller.
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
   * Sync managed instances with the given server + workspace configs: drop removed, restart changed, add new.
   *
   * @param configs - Every base server; each is keyed by its name.
   * @param [workspaces] - Every workspace; a member whose server is not in `configs` is skipped.
   *
   * @remarks
   * Each workspace member gets its own instance keyed `w:<slug>:<server>` with the workspace's overrides applied, so a
   * workspace can run a server independently of its global state. Awaiting it is what makes a write visible to the
   * read that follows: the pool serializes reconciles behind whatever it is already doing.
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
   * Connect (spawning if needed) and return the downstream client for the given instance key.
   *
   * @param key - A base server's name, or a workspace instance's {@link workspaceInstanceKey}.
   * @returns The connected client. Throws a 404 for an unknown or disabled instance, a 503 while it is backed off
   * after a crash, and a 502 when it will not connect.
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
   * @param key - The instance; an unknown one is ignored.
   * @param client - The connected client, read for its instructions and server capabilities.
   *
   * @remarks
   * Read on every use rather than only on the connects: these are field accesses, and there is no event to hang them
   * off, since the pool reaps, respawns and redials on its own and each of those is a fresh handshake.
   */
  private observe(key: InstanceKey, client: Client): void {
    const meta = this.meta.get(key);
    if (meta) {
      meta.handshake = { instructions: client.getInstructions(), capabilities: client.getServerCapabilities() };
    }
  }

  /**
   * Run one downstream request against the instance's client, redialling if its session turns out to be dropped.
   *
   * @typeParam T - What the request resolves to.
   * @param key - The instance to reach.
   * @param run - The request. Called a second time, with the new client, after a redial.
   * @returns What `run` resolved to. A refusal by the pool is thrown as `getClient` throws it; what `run` rejects
   * with is rethrown untouched.
   *
   * @remarks
   * The redial is the pool's (`McpPool.use`): a remote server that restarts or reclaims a session answers every later
   * request `404` or `400` without closing anything, so the row stays `ready` and is never reaped. Both are refusals
   * before dispatch, which is what makes the second attempt safe for a `tools/call`.
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
   * Reads what the downstream said at its last connect, without connecting.
   *
   * @param key - The instance.
   * @returns The handshake; empty when the instance is unknown or has not connected since its connection last changed.
   *
   * @remarks
   * The aggregate endpoint asks this for every member while a client is initializing, and spawning a dozen children
   * to write a preamble the session may never act on is not a trade worth making.
   */
  handshake(key: InstanceKey): Handshake {
    return this.meta.get(key)?.handshake ?? {};
  }

  /**
   * Drop an instance's connection and dial it again.
   *
   * @param key - The instance to restart.
   * @returns The new client. Throws as `getClient` does; a restart that fails is a 502 carrying the child's stderr.
   *
   * @remarks
   * `stop` rather than the pool's `reconnect`: `stop` clears the row's error and backoff, so the `getClient` after it
   * is the dial. `reconnect` dials itself (pool 2.2.0), so a failed restart lands in a backoff it just started and
   * answers 503 "crashed recently", naming a crash the operator just asked to be retried.
   */
  async restart(key: InstanceKey): Promise<Client> {
    await this.pool.stop(key);
    return this.getClient(key);
  }

  /**
   * Re-throw one of the pool's refusals as the status this API answers it with.
   *
   * @param key - The instance, named in the message by its server name.
   * @param cause - What was caught; anything but an McpPoolError is rethrown untouched.
   *
   * @remarks
   * The wording stays the router's own: these strings are part of the REST contract and are read by the UI. `backoff`
   * (503) and `connect-failed` (502) are kept apart: the first means the pool declined to dial, the second that it
   * dialled and could not.
   */
  private fail(key: InstanceKey, cause: unknown): never {
    const isPoolError = cause instanceof McpPoolError;
    if (isPoolError === false) {
      throw cause;
    }
    const name = this.meta.get(key)?.config.name ?? key;
    switch (cause.code) {
      case 'unknown-server':
        throw notFound(`Unknown server "${name}"`, undefined, { cause });
      case 'disabled':
        throw notFound(`Server "${name}" is disabled`, undefined, { cause });
      case 'backoff':
        throw unavailable(`Server "${name}" crashed recently; retrying is backed off`, cause.detail, { cause });
      default:
        throw upstreamFailed(`Failed to connect to server "${name}"`, cause.detail, { cause });
    }
  }

  /**
   * Reads the pool's connection rows.
   *
   * @returns The rows by instance key, without their secrets: nothing here reads a row's config.
   */
  private connectionState(): Map<InstanceKey, McpServerState> {
    return new Map(this.pool.state().map((row) => [row.id, row]));
  }

  /**
   * Reports one instance's config, connection state and call bookkeeping.
   *
   * @param key - The instance.
   * @returns The status, or undefined for an instance this manager does not hold.
   */
  status(key: InstanceKey): ServerStatus | undefined {
    const meta = this.meta.get(key);
    return meta ? toStatus(meta, this.connectionState().get(key)) : undefined;
  }

  /**
   * Reports every base server's status.
   *
   * @returns The statuses sorted by server name; workspace instances are left out.
   */
  statusAll(): ServerStatus[] {
    const state = this.connectionState();
    // Only base servers are exposed as "servers"; workspace-scoped instances are an internal detail.
    return [...this.meta]
      .filter(([key]) => isBaseServerKey(key))
      .map(([key, meta]) => toStatus(meta, state.get(key)))
      .sort((a, b) => a.config.name.localeCompare(b.config.name));
  }

  /**
   * Counts the base servers with a live connection.
   *
   * @returns How many are `ready`; workspace instances are not counted.
   */
  runningCount(): number {
    return this.pool.state().filter((row) => isBaseServerKey(row.id) && row.status === 'ready').length;
  }

  /**
   * Subscribe to downstream server→client notifications.
   *
   * @param listener - Called with the instance key and the raw notification, for every instance.
   * @returns An unsubscribe function.
   *
   * @remarks
   * Used by MCP sessions to relay list_changed / resources/updated / log messages to their upstream client. It
   * survives downstream respawns because the pool re-installs the handler on every connect.
   */
  onNotification(listener: (key: InstanceKey, notification: Notification) => void): () => void {
    return this.pool.onNotification(listener);
  }

  /**
   * Notes how many tools an instance last listed, for its status.
   *
   * @param key - The instance; an unknown one is ignored.
   * @param count - The size of the full `tools/list`.
   */
  recordToolCount(key: InstanceKey, count: number): void {
    const meta = this.meta.get(key);
    if (meta) {
      meta.toolCount = count;
    }
  }

  /**
   * Count a call against its instance and append it to the activity log.
   *
   * @param key - The instance; a call for one that has been removed is dropped.
   * @param entry - The call; its `at` becomes the instance's last-called time.
   */
  recordActivity(key: InstanceKey, entry: ActivityRecord): void {
    // A call that finishes after its server was removed must not bring the log
    // back. One that finishes after a Clear is new activity and is kept.
    const meta = this.meta.get(key);
    if (!meta) {
      return;
    }
    meta.callCount += 1;
    meta.lastCalledAt = entry.at;
    this.activity.record(key, entry);
  }

  /**
   * Reads the recorded activity for an instance.
   *
   * @param key - The instance.
   * @returns The entries, newest first; empty for an unknown instance.
   */
  getActivity(key: InstanceKey): ActivityEntry[] {
    return this.activity.newestFirst(key);
  }

  /**
   * Empties an instance's activity log; its call count is kept.
   *
   * @param key - The instance.
   */
  clearActivity(key: InstanceKey): void {
    this.activity.clear(key);
  }

  /**
   * Lists the enabled base servers, for the global aggregate endpoint.
   *
   * @returns Their names, sorted.
   */
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

/**
 * Joins the router's bookkeeping with the pool's connection row into the status the API reports.
 *
 * @param meta - The config and call bookkeeping.
 * @param state - The pool's row; undefined reads as stopped.
 * @returns The status, with the pool's empty-string "no error" reported as absent.
 */
function toStatus(meta: ServerMeta, state: McpServerState | undefined): ServerStatus {
  return {
    config: meta.config,
    state: state ? RUNTIME_STATE[state.status] : ServerRuntimeState.Stopped,
    pid: state?.pid,
    startedAt: state?.startedAt,
    // The pool reports "no error" as an empty string; this API reports it as absent.
    lastError: state?.error || undefined,
    toolCount: meta.toolCount,
    callCount: meta.callCount,
    lastCalledAt: meta.lastCalledAt,
  };
}
