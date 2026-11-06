import type { LanServer, ServerWatch, ServerWatchHandlers } from '@cubicecho/mcp-discovery/mdns';
import {
  type DiscoveredServer,
  DiscoveredServerState,
  type ServerConfig,
  serverNameSchema,
  suggestServerName,
  TRANSPORT_STREAMABLE_HTTP,
} from '@mcp-router/shared';
import { ROUTER_ROLE_META_KEY } from './endpoints.ts';

/** What the LAN watch needs from the router. */
export interface LanServersDeps {
  /** Whether to watch; read on every `sync`, so it follows `settings.lanDiscovery`. */
  isWanted: () => boolean;
  /** The router's own mDNS instance name, so it never offers itself. */
  ownInstanceName: () => string;
  /** The server configs, to tell which found servers are already added. */
  servers: () => ServerConfig[];
  /** The discovery keys the user dismissed. */
  dismissed: () => string[];
  /** Called when a server added from the network turns up at a new URL, to point its config there. */
  onMoved: (server: ServerConfig, url: string) => Promise<void>;
  /** Writes a line to the log. */
  log: (message: string) => void;
  /** Starts the network watch; `watchServers` from `@cubicecho/mcp-discovery/mdns`, replaced in tests. */
  watch: (handlers: ServerWatchHandlers) => Promise<Pick<ServerWatch, 'stop'>>;
}

/** The servers found on the local network, as the router offers them. */
export interface LanServers {
  /** Starts or stops watching to match `isWanted()`. */
  sync: () => Promise<void>;
  /** Every found server, with whether it is available, added or dismissed. */
  list: () => DiscoveredServer[];
  /** Stops watching; call on shutdown. */
  close: () => Promise<void>;
}

/**
 * The same endpoint URL however it was written, so a hand-added server matches the one found.
 *
 * @param url - A URL.
 * @returns It without a trailing slash, or as given when it does not parse.
 */
function sameUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * The config, if any, that a found server was added as or that already points at its URL.
 *
 * @param found - A found server with a usable connection.
 * @param url - Its endpoint URL.
 * @param servers - The router's server configs.
 * @returns The config, or undefined when none matches.
 */
function addedAs(found: LanServer, url: string, servers: ServerConfig[]): ServerConfig | undefined {
  const byKey = servers.find((server) => server.discovered?.key === found.key);
  if (byKey) {
    return byKey;
  }
  return servers.find(
    (server) => server.transport.type === TRANSPORT_STREAMABLE_HTTP && sameUrl(server.transport.url) === sameUrl(url),
  );
}

/**
 * A local name for a found server that no config uses yet.
 *
 * @param found - A found server.
 * @param servers - The router's server configs.
 * @returns E.g. `skills`, or `skills-2` when `skills` is taken.
 */
function freeName(found: LanServer, servers: ServerConfig[]): string {
  const taken = new Set(servers.map((server) => server.name));
  const base = suggestServerName(found.card.name) || 'server';
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix++) {
    candidate = `${base}-${suffix}`;
  }
  return serverNameSchema.safeParse(candidate).success ? candidate : 'server';
}

/**
 * What has become of a found server.
 *
 * @param config - The config it was added as, if any.
 * @param isDismissed - Whether the user dismissed it.
 * @returns Added wins over dismissed: a server added by hand after a dismissal shows as added.
 */
function stateOf(config: ServerConfig | undefined, isDismissed: boolean): DiscoveredServerState {
  if (config) {
    return DiscoveredServerState.Added;
  }
  return isDismissed ? DiscoveredServerState.Dismissed : DiscoveredServerState.Available;
}

/**
 * Builds the LAN watch; nothing is watched until the first `sync`.
 *
 * @param deps - The setting, the router's own name, its configs, and the network watch.
 * @returns The watch.
 *
 * @remarks
 * Other routers' cards (those with the router role in `_meta`) and the router's own are left out, so two routers
 * never add each other in a loop. A found server with no streamable-HTTP URL it can use as it stands is left out
 * too.
 */
export function createLanServers(deps: LanServersDeps): LanServers {
  const found = new Map<string, LanServer>();
  let watch: Pick<ServerWatch, 'stop'> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const isOffered = (server: LanServer): boolean => {
    const isSelf = server.host.name === deps.ownInstanceName();
    const isRouter = server.card._meta?.[ROUTER_ROLE_META_KEY] !== undefined;
    return isSelf === false && isRouter === false && server.connection !== null;
  };

  const followMove = (server: LanServer): void => {
    const url = server.connection?.url;
    const config = deps.servers().find((candidate) => candidate.discovered?.key === server.key);
    const hasMoved =
      url !== undefined &&
      config?.transport.type === TRANSPORT_STREAMABLE_HTTP &&
      sameUrl(config.transport.url) !== sameUrl(url);
    if (hasMoved && config) {
      deps.log(`[discovery] ${config.name} moved to ${url}`);
      deps.onMoved(config, url).catch((error: unknown) => {
        deps.log(`[discovery] could not point ${config.name} at ${url}: ${String(error)}`);
      });
    }
  };

  const handlers: ServerWatchHandlers = {
    onUp: (server) => {
      if (isOffered(server) === false) {
        return;
      }
      found.set(server.key, server);
      followMove(server);
    },
    onDown: (server) => {
      found.delete(server.key);
    },
    onError: (error) => deps.log(`[discovery] ${error.message}`),
  };

  const apply = async (): Promise<void> => {
    const isWanted = deps.isWanted();
    if (isWanted && watch === null) {
      try {
        watch = await deps.watch(handlers);
        deps.log('[discovery] watching the local network for MCP servers');
      } catch (error) {
        deps.log(`[discovery] could not watch the local network: ${String(error)}`);
      }
      return;
    }
    if (isWanted === false && watch) {
      const stopping = watch;
      watch = null;
      found.clear();
      await stopping.stop();
      deps.log('[discovery] stopped watching the local network');
    }
  };

  const stop = async (): Promise<void> => {
    if (watch) {
      const stopping = watch;
      watch = null;
      await stopping.stop();
    }
  };

  const enqueue = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(step, step);
    return queue;
  };

  return {
    sync: () => enqueue(apply),
    close: () => enqueue(stop),
    list: () => {
      const servers = deps.servers();
      const dismissed = new Set(deps.dismissed());
      return [...found.values()].flatMap((server): DiscoveredServer[] => {
        const { connection, card } = server;
        if (!connection) {
          return [];
        }
        const config = addedAs(server, connection.url, servers);
        const state = stateOf(config, dismissed.has(server.key));
        return [
          {
            key: server.key,
            cardName: card.name,
            ...(card.title ? { title: card.title } : {}),
            description: card.description,
            version: card.version,
            host: server.host.name,
            url: connection.url,
            requiredHeaders: connection.requiredHeaders,
            suggestedName: freeName(server, servers),
            state,
            ...(config ? { serverName: config.name } : {}),
          },
        ];
      });
    },
  };
}

/**
 * A LAN watch that never watches, for an app built without one (tests, tools).
 *
 * @returns One whose list is always empty.
 */
export function idleLanServers(): LanServers {
  return { sync: async () => undefined, list: () => [], close: async () => undefined };
}
