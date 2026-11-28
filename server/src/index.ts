import { createAdvertiser, watchServers } from '@cubicecho/mcp-discovery/mdns';
import { TRANSPORT_STREAMABLE_HTTP } from '@mcp-router/shared';
import { createAuthHost } from './auth/auth-host.ts';
import { ImportedFrom } from './auth/keys.ts';
import { carryOverRouterTokens } from './auth/router-token.ts';
import {
  databaseUrl,
  dbConnectTimeoutMs,
  dataDir as envDataDir,
  isProduction,
  listenHost,
  listenPort,
  oidcRedirectUri,
  publicLocalNetError,
  refuseBadAuthConfig,
  routerUrl,
  secureLocalNet,
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
  // First, so a router with no Postgres fails with a sentence before anything opens.
  const url = databaseUrl();
  refuseBadAuthConfig();
  const dataDir = envDataDir();
  const database = openDatabase(url, { isProduction: isProduction() });
  try {
    await waitForDatabase(database.db, { connectTimeoutMs: dbConnectTimeoutMs() });
  } catch (error) {
    throw new Error(`[db] Could not reach ${database.location}`, { cause: error });
  }
  await database.ensureSchema();
  console.log(`[db] using ${database.location}`);
  const store = new ConfigStore({ db: database.db, dataDir });
  await store.init();

  // Whoever opens the UI on a trusted network is the admin, so the router's address must be a private one.
  const exposed = publicLocalNetError(routerUrl(store.getSettings()));
  if (exposed !== undefined) {
    throw new Error(`[auth] ${exposed}`);
  }
  // The old router token becomes an API key, so MCP clients configured with it keep working.
  const carried = await carryOverRouterTokens(database.db, store);
  for (const from of carried.imported) {
    const where = from === ImportedFrom.Env ? 'MCP_ROUTER_TOKEN' : 'the stored router token';
    console.log(`[auth] imported ${where} as an API key; clients configured with it keep working`);
  }
  if (carried.wasAuthDisabled) {
    console.warn(
      '[auth] authEnabled is false in the settings, which no longer turns auth off: /mcp takes an API key, and the UI a ' +
        'sign-in. Set SECURE_LOCAL_NET=true on a private network to sign the UI in without a provider.',
    );
  }
  const authHost = await createAuthHost(database.db, { baseUrl: () => routerUrl(store.getSettings()) });
  // better-auth is built for one address: a new publicUrl needs a new instance. Sessions are rows, so nobody is signed out.
  let builtFor = authHost.baseUrl();
  store.on('change', () => {
    const next = routerUrl(store.getSettings());
    if (next !== builtFor) {
      builtFor = next;
      authHost.rebuild().catch((error: unknown) => {
        console.error('[auth] could not rebuild sign-in for the new publicUrl:', error);
      });
    }
  });

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

  const app = createApp({ store, manager, oauth, lanServers, db: database.db, authHost });
  const onListen = () => {
    console.log(`[server] listening on http://${host ?? 'localhost'}:${port} (data dir: ${dataDir})`);
    logSignIn(authHost.oidc(), authHost.baseUrl());
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

/**
 * Says at boot how people sign in to the UI, and warns when nobody can.
 *
 * @param oidc - The provider sign-in uses, or null.
 * @param baseUrl - The router's address.
 */
function logSignIn(oidc: { name: string; issuer: string } | null, baseUrl: string): void {
  console.log(`[auth] router address ${baseUrl}; MCP clients and agents send an API key, made in Settings`);
  if (secureLocalNet()) {
    console.warn(
      '[auth] SECURE_LOCAL_NET is on: whoever opens the UI is signed in as the local admin. Private networks only.',
    );
  }
  if (oidc !== null) {
    console.log(`[auth] sign-in with ${oidc.name} (${oidc.issuer}); redirect URI ${oidcRedirectUri(baseUrl)}`);
  }
  if (oidc === null && secureLocalNet() === false) {
    console.warn(
      '[auth] no way to sign in to the UI yet: paste a setup URL from your OIDC provider on the login page, set ' +
        'OIDC_ISSUER and OIDC_CLIENT_ID, or set SECURE_LOCAL_NET=true on a private network.',
    );
  }
}

main().catch((err: unknown) => {
  console.error('[server] could not start:', err);
  process.exit(1);
});
