import { isDeepStrictEqual } from 'node:util';
import type { ActivityEntry, ServerConfig, ServerStatus, SettingsFile } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { errorMessage, HttpError } from '../errors.ts';
import { SERVER_VERSION } from '../version.ts';

const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'NODE_ENV',
  'LANG',
  'TERM',
  // uv/uvx (pypi servers): let the router's cache/python-install locations
  // reach the child so downloads persist across spawns instead of re-fetching.
  'UV_CACHE_DIR',
  'UV_PYTHON_INSTALL_DIR',
] as const;
const CRASH_BACKOFF_MS = 5_000;
const STDERR_TAIL_CHARS = 4_000;
/** Max activity entries kept per server (in-memory ring buffer). */
const ACTIVITY_LIMIT = 200;
/** Extra slack kept before trimming, so the O(n) shift amortizes to O(1) per record. */
const ACTIVITY_TRIM_BATCH = 64;
/** Serialized params/result (and error/target strings) larger than this are truncated before storing. */
const ACTIVITY_VALUE_CHARS = 8_000;

/** Cap a string at `max` chars (never splitting a surrogate pair), appending a truncation marker. */
function truncateString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  // A high surrogate at the cut point would leave an unpaired half; cut before it.
  const last = value.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return `${value.slice(0, end)}… [truncated, ${value.length} chars]`;
}

/**
 * Snapshot a recorded params/result into a bounded, detached value.
 *
 * Never retains a reference to the caller's value: a small payload is returned
 * as a fresh structural clone (so it can't pin memory or alias later mutations
 * into the log, yet keeps its shape — the schema's `unknown` stays truthful and
 * the UI can pretty-print it), and an over-large one collapses to a truncation
 * marker string. Serialization is compact so the size budget isn't spent on
 * indentation.
 */
function snapshotValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
  if (serialized === undefined) {
    return undefined; // functions / symbols serialize to nothing
  }
  if (serialized.length > ACTIVITY_VALUE_CHARS) {
    return truncateString(serialized, ACTIVITY_VALUE_CHARS);
  }
  return JSON.parse(serialized);
}

interface ManagedServer {
  config: ServerConfig;
  client: Client | null;
  connecting: Promise<Client> | null;
  state: ServerStatus['state'];
  pid?: number;
  startedAt?: string;
  lastError?: string;
  toolCount?: number;
  idleTimer: NodeJS.Timeout | null;
  stderrTail: string;
  lastCrashAt: number;
  stopping: boolean;
}

function newEntry(config: ServerConfig): ManagedServer {
  return {
    config,
    client: null,
    connecting: null,
    state: 'stopped',
    idleTimer: null,
    stderrTail: '',
    lastCrashAt: 0,
    stopping: false,
  };
}

/** Env passed to stdio children: a small allowlist of the router's env plus the server's configured env. */
export function buildChildEnv(configEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...configEnv };
}

/** True when two configs differ in a way that requires restarting the downstream connection. */
export function needsRestart(a: ServerConfig, b: ServerConfig): boolean {
  return !isDeepStrictEqual(
    { transport: a.transport, env: a.env, idleTimeoutMs: a.idleTimeoutMs },
    { transport: b.transport, env: b.env, idleTimeoutMs: b.idleTimeoutMs },
  );
}

/**
 * One downstream MCP Client per server. stdio servers are spawned lazily on
 * first use and killed after an idle timeout; remote servers get a
 * streamable-http client connection. Crashes flip the state to 'error' with a
 * stderr tail and are retried (with a short backoff) on the next request.
 */
export class GatewayManager {
  private readonly entries = new Map<string, ManagedServer>();
  private readonly getSettings: () => SettingsFile;
  /** In-memory per-server ring buffer of proxied calls, for the Activity tab. */
  private readonly activity = new Map<string, ActivityEntry[]>();
  private activitySeq = 0;

  constructor(getSettings: () => SettingsFile) {
    this.getSettings = getSettings;
  }

  /** Sync managed entries with the given configs: drop removed, restart changed/disabled, add new. */
  reconcile(configs: ServerConfig[]): void {
    const byName = new Map(configs.map((c) => [c.name, c]));
    for (const [name, entry] of this.entries) {
      const next = byName.get(name);
      if (!next) {
        void this.stop(name);
        this.entries.delete(name);
        this.activity.delete(name);
        continue;
      }
      if (needsRestart(entry.config, next)) {
        void this.stop(name);
        entry.toolCount = undefined;
      } else if (!next.enabled && entry.config.enabled) {
        void this.stop(name);
      }
      entry.config = next;
    }
    for (const [name, config] of byName) {
      if (!this.entries.has(name)) {
        this.entries.set(name, newEntry(config));
      }
    }
  }

  /** Connect (spawning if needed) and return the downstream client. Resets the idle timer. */
  async getClient(name: string): Promise<Client> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    if (!entry.config.enabled) {
      throw new HttpError(404, `Server "${name}" is disabled`);
    }
    if (entry.client) {
      this.touch(entry);
      return entry.client;
    }
    if (entry.connecting) {
      return entry.connecting;
    }
    const connecting = this.connect(entry).finally(() => {
      entry.connecting = null;
    });
    entry.connecting = connecting;
    return connecting;
  }

  status(name: string): ServerStatus | undefined {
    const entry = this.entries.get(name);
    return entry ? toStatus(entry) : undefined;
  }

  statusAll(): ServerStatus[] {
    return [...this.entries.values()].map(toStatus).sort((a, b) => a.config.name.localeCompare(b.config.name));
  }

  runningCount(): number {
    return [...this.entries.values()].filter((e) => e.state === 'running').length;
  }

  recordToolCount(name: string, count: number): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.toolCount = count;
    }
  }

  /** Append a proxied call to the server's in-memory activity log (bounded, newest last). */
  recordActivity(name: string, entry: Omit<ActivityEntry, 'id'>): void {
    // Only log for a currently-managed server: an in-flight call that completes
    // after the server was removed (reconcile drops it from both maps) must not
    // resurrect a stray activity entry that then leaks forever. A call that
    // completes right after a Clear legitimately re-populates the log — the
    // server still exists, so that is new activity, not a leak.
    if (!this.entries.has(name)) {
      return;
    }
    const log = this.activity.get(name) ?? [];
    log.push({
      ...entry,
      id: ++this.activitySeq,
      // Bound every payload-bearing field, not just params/result: error messages
      // and targets (e.g. data: URIs) can embed arbitrarily large payloads too.
      target: entry.target === undefined ? undefined : truncateString(entry.target, ACTIVITY_VALUE_CHARS),
      error: entry.error === undefined ? undefined : truncateString(entry.error, ACTIVITY_VALUE_CHARS),
      params: snapshotValue(entry.params),
      result: snapshotValue(entry.result),
    });
    // Trim in batches rather than on every push, so the O(n) shift amortizes away.
    if (log.length > ACTIVITY_LIMIT + ACTIVITY_TRIM_BATCH) {
      log.splice(0, log.length - ACTIVITY_LIMIT);
    }
    this.activity.set(name, log);
  }

  /** Recorded activity for a server, newest first (at most ACTIVITY_LIMIT). */
  getActivity(name: string): ActivityEntry[] {
    return (this.activity.get(name) ?? []).slice(-ACTIVITY_LIMIT).reverse();
  }

  clearActivity(name: string): void {
    this.activity.delete(name);
  }

  /** Names of all enabled servers (for the aggregate endpoint). */
  enabledNames(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.config.enabled)
      .map((e) => e.config.name)
      .sort();
  }

  /** Close the downstream client / kill the child process. Safe to call when already stopped. */
  async stop(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) {
      return;
    }
    entry.stopping = true;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    const client = entry.client ?? (await entry.connecting?.catch(() => null)) ?? null;
    entry.client = null;
    entry.pid = undefined;
    entry.startedAt = undefined;
    entry.state = 'stopped';
    if (client) {
      try {
        await client.close();
      } catch (err) {
        console.warn(`Error closing client for "${name}": ${errorMessage(err)}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((name) => this.stop(name)));
  }

  private async connect(entry: ManagedServer): Promise<Client> {
    const { config } = entry;
    if (config.transport.type === 'stdio' && Date.now() - entry.lastCrashAt < CRASH_BACKOFF_MS) {
      throw new HttpError(503, `Server "${config.name}" crashed recently; retrying is backed off`, entry.lastError);
    }
    entry.state = 'starting';
    entry.stopping = false;
    entry.stderrTail = '';
    const client = new Client({ name: 'mcp-router', version: SERVER_VERSION });
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    if (config.transport.type === 'stdio') {
      const stdioTransport = new StdioClientTransport({
        command: config.transport.command,
        args: config.transport.args,
        cwd: config.transport.cwd,
        env: buildChildEnv(config.env),
        stderr: 'pipe',
      });
      stdioTransport.stderr?.on('data', (chunk: Buffer) => {
        entry.stderrTail = (entry.stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
      });
      transport = stdioTransport;
    } else {
      transport = new StreamableHTTPClientTransport(new URL(config.transport.url), {
        requestInit: { headers: config.transport.headers },
      });
    }
    try {
      await client.connect(transport);
    } catch (cause) {
      entry.state = 'error';
      entry.lastError = entry.stderrTail.trim() || errorMessage(cause);
      if (config.transport.type === 'stdio') {
        entry.lastCrashAt = Date.now();
      }
      throw new HttpError(502, `Failed to connect to server "${config.name}"`, entry.lastError, { cause });
    }
    entry.client = client;
    entry.state = 'running';
    entry.startedAt = new Date().toISOString();
    entry.pid = transport instanceof StdioClientTransport ? (transport.pid ?? undefined) : undefined;
    client.onclose = () => {
      if (entry.client !== client) {
        return;
      }
      entry.client = null;
      entry.pid = undefined;
      entry.startedAt = undefined;
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      if (entry.stopping) {
        entry.state = 'stopped';
      } else {
        // Unexpected exit: surface the stderr tail and back off respawns briefly.
        entry.state = 'error';
        entry.lastError = entry.stderrTail.trim() || 'process exited unexpectedly';
        entry.lastCrashAt = Date.now();
        console.warn(`Server "${config.name}" exited unexpectedly: ${entry.lastError.split('\n').at(-1)}`);
      }
    };
    this.touch(entry);
    return client;
  }

  /** Reset the idle shutdown timer (stdio servers only). */
  private touch(entry: ManagedServer): void {
    if (entry.config.transport.type !== 'stdio') {
      return;
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }
    const timeoutMs = entry.config.idleTimeoutMs ?? this.getSettings().idleTimeoutMs;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      this.stop(entry.config.name).catch((err: unknown) => {
        console.warn(`Idle shutdown of "${entry.config.name}" failed: ${errorMessage(err)}`);
      });
    }, timeoutMs);
    entry.idleTimer.unref();
  }
}

function toStatus(entry: ManagedServer): ServerStatus {
  return {
    config: entry.config,
    state: entry.state,
    pid: entry.pid,
    startedAt: entry.startedAt,
    lastError: entry.lastError,
    toolCount: entry.toolCount,
  };
}
