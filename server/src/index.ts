import { createAdvertiser, watchServers } from '@cubicecho/mcp-discovery/mdns';
import { TRANSPORT_STREAMABLE_HTTP } from '@mcp-router/shared';
import {
  authDisabledByEnv,
  databaseUrl,
  dbConnectTimeoutMs,
  dataDir as envDataDir,
  envToken,
  listenHost,
  listenPort,
  refusePlaceholderToken,
} from './config/env.ts';
import { ConfigStore } from './config/store.ts';
import { openDatabase } from './db/client.ts';
import { waitForDatabase } from './db/wait.ts';
import { createLanServers } from './discovery/lan-servers.ts';
import { GatewayManager } from './gateway/manager.ts';
import { reconcileOnChange } from './gateway/reconcile.ts';
import { createApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { tuneInbound } from './http/tuning.ts';
import { OAuthService } from './oauth/service.ts';

/** Hosts that only this machine can reach. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Opens and migrates the database, loads the config, starts the gateway and the HTTP server, and arranges a graceful
 * stop on SIGTERM or SIGINT.
 */
async function main(): Promise<void> {
  refusePlaceholderToken();
  const dataDir = envDataDir();
  const database = openDatabase(databaseUrl(), dataDir);
  if (database.isPostgres) {
    try {
      await waitForDatabase(database.db, { connectTimeoutMs: dbConnectTimeoutMs() });
    } catch (error) {
      throw new Error(`Could not reach ${database.location}`, { cause: error });
    }
  }
  await database.ensureSchema();
  console.log(`[db] using ${database.location}`);
  const store = new ConfigStore({ db: database.db, dataDir });
  await store.init();

  const oauth = new OAuthService(store);
  const manager = new GatewayManager(() => store.getSettings(), oauth);
  // After a sign-in or sign-out, every connection of that server dials again with what is stored now.
  oauth.setOnChange((name) => manager.resetServer(name));
  await manager.reconcile(store.getServers(), store.getWorkspaces());
  reconcileOnChange({ store, manager });

  const port = listenPort(store.getSettings().port);
  // Unset binds all interfaces (Docker/LAN); set HOST=127.0.0.1 to restrict to localhost.
  const host = listenHost(store.getSettings().host);
  const instanceName = () => `MCP Router on ${store.getSettings().instanceId ?? 'router'}`;
  // A router bound to loopback can't be reached from the LAN, so announcing it would only mislead.
  const isLanReachable = host === undefined || LOOPBACK_HOSTS.has(host) === false;
  const advertiser = createAdvertiser({
    isWanted: () => store.getSettings().lanAdvertise && isLanReachable,
    options: () => ({ name: instanceName(), port }),
    log: (message) => console.log(`[discovery] ${message}`),
  });
  const lanServers = createLanServers({
    isWanted: () => store.getSettings().lanDiscovery,
    ownInstanceName: instanceName,
    servers: () => store.getServers(),
    dismissed: () => store.getSettings().lanDismissed,
    onMoved: async (server, url) => {
      if (server.transport.type !== TRANSPORT_STREAMABLE_HTTP) {
        return;
      }
      await store.saveServer({ ...server, transport: { ...server.transport, url } });
      await manager.reconcile(store.getServers(), store.getWorkspaces());
    },
    log: console.log,
    watch: (handlers) => watchServers(handlers),
  });
  // A toggle in the UI writes the settings, so it arrives as a change.
  store.on('change', () => {
    void advertiser.sync();
    void lanServers.sync();
  });
  if (store.getSettings().lanAdvertise && isLanReachable === false) {
    console.warn(`[discovery] lanAdvertise is on, but the router listens on ${host} only, so it is not announced`);
  }

  const app = createApp({ store, manager, oauth, lanServers, db: database.db });
  const onListen = () => {
    console.log(`[server] listening on http://${host ?? 'localhost'}:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    if (authDisabledByEnv()) {
      console.warn(
        '[auth] SECURE_LOCAL_NET is on: /graphql, /admin/mcp and /mcp are open to this network. Private networks only.',
      );
    } else if (settings.authEnabled === false) {
      console.warn('[auth] authEnabled is false in the settings: /graphql, /admin/mcp and /mcp are open.');
    } else if (envToken() !== undefined) {
      console.log('[auth] bearer token from MCP_ROUTER_TOKEN, which overrides the stored one');
    } else {
      // Where it is, never the token: boot logs are kept and shipped, and the token is printed once, when it is generated.
      console.log(`[auth] bearer token is auth_token in the settings table of ${database.location}`);
    }
    // After listen, so whoever finds the announcement can already read the catalog.
    void advertiser.sync();
    void lanServers.sync();
  };
  const httpServer = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  tuneInbound(httpServer);

  // The announcement goes first, so the goodbye is sent while the router can still answer. The children go after the
  // drain, once no request needs them, and the database last, once nothing writes to it.
  stopOnSignals(httpServer, {
    before: async () => {
      await advertiser.close();
      await lanServers.close();
    },
    after: async () => {
      await manager.stopAll();
      await database.close();
    },
  });
}

main().catch((err: unknown) => {
  console.error('[server] could not start:', err);
  process.exit(1);
});
