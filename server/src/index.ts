import path from 'node:path';
import { createAdvertiser, watchServers } from '@cubicecho/mcp-discovery/mdns';
import { TRANSPORT_STREAMABLE_HTTP } from '@mcp-router/shared';
import {
  authDisabledByEnv,
  dataDir as envDataDir,
  envToken,
  listenHost,
  listenPort,
  refusePlaceholderToken,
} from './config/env.ts';
import { ConfigStore } from './config/store.ts';
import { errorMessage } from './core/errors.ts';
import { createLanServers } from './discovery/lan-servers.ts';
import { GatewayManager } from './gateway/manager.ts';
import { createApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { tuneInbound } from './http/tuning.ts';
import { OAuthService } from './oauth/service.ts';

/** Hosts that only this machine can reach. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** Loads the config, starts the gateway and the HTTP server, and arranges a graceful stop on SIGTERM or SIGINT. */
async function main(): Promise<void> {
  refusePlaceholderToken();
  const dataDir = envDataDir();
  const store = new ConfigStore(dataDir);
  await store.init();

  const oauth = new OAuthService(store);
  const manager = new GatewayManager(() => store.getSettings(), oauth);
  // After a sign-in or sign-out, every connection of that server dials again with what is stored now.
  oauth.setOnChange((name) => manager.resetServer(name));
  await manager.reconcile(store.getServers(), store.getWorkspaces());
  store.on('change', (state) => {
    console.log('[config] changed on disk, reconciling servers');
    manager.reconcile(state.servers, state.workspaces).catch((err: unknown) => {
      console.warn(`[config] reconcile after a config change failed: ${errorMessage(err)}`);
    });
  });
  store.startWatching();

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
  // A toggle in the UI writes settings.json, so it arrives as a change like a hand edit.
  store.on('change', () => {
    void advertiser.sync();
    void lanServers.sync();
  });
  if (store.getSettings().lanAdvertise && isLanReachable === false) {
    console.warn(`[discovery] lanAdvertise is on, but the router listens on ${host} only, so it is not announced`);
  }

  const app = createApp({ store, manager, oauth, lanServers });
  const onListen = () => {
    console.log(`[server] listening on http://${host ?? 'localhost'}:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    if (authDisabledByEnv()) {
      console.warn('[auth] SECURE_LOCAL_NET is on: /api and /mcp are open to this network. Private networks only.');
    } else if (settings.authEnabled === false) {
      console.warn('[auth] authEnabled is false in settings.json: /api and /mcp are open.');
    } else if (envToken() !== undefined) {
      console.log('[auth] bearer token from MCP_ROUTER_TOKEN, which overrides settings.json');
    } else {
      // The path, never the token: boot logs are kept and shipped, and the token is printed once, when it is generated.
      console.log(`[auth] bearer token is authToken in ${path.join(dataDir, 'config/settings.json')}`);
    }
    // After listen, so whoever finds the announcement can already read the catalog.
    void advertiser.sync();
    void lanServers.sync();
  };
  const httpServer = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  tuneInbound(httpServer);

  // The watcher stops first, so a config edit during the drain starts nothing. The children go last, once no request needs them.
  // The announcement goes first, so the goodbye is sent while the router can still answer.
  stopOnSignals(httpServer, {
    before: async () => {
      await advertiser.close();
      await lanServers.close();
      await store.close();
    },
    after: () => manager.stopAll(),
  });
}

main().catch((err: unknown) => {
  console.error('[server] could not start:', err);
  process.exit(1);
});
