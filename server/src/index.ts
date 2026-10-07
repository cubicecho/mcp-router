import path from 'node:path';
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
import { GatewayManager } from './gateway/manager.ts';
import { buildApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';
import { tuneInbound } from './http/tuning.ts';

async function main(): Promise<void> {
  refusePlaceholderToken();
  const dataDir = envDataDir();
  const store = new ConfigStore(dataDir);
  await store.init();

  const manager = new GatewayManager(() => store.getSettings());
  await manager.reconcile(store.getServers(), store.getWorkspaces());
  store.on('change', (state) => {
    console.log('[config] changed on disk, reconciling servers');
    manager.reconcile(state.servers, state.workspaces).catch((err: unknown) => {
      console.warn(`[config] reconcile after a config change failed: ${errorMessage(err)}`);
    });
  });
  store.startWatching();

  const app = buildApp({ store, manager });
  const port = listenPort(store.getSettings().port);
  // Unset binds all interfaces (Docker/LAN); set HOST=127.0.0.1 to restrict to localhost.
  const host = listenHost(store.getSettings().host);
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
  };
  const httpServer = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  tuneInbound(httpServer);

  // The watcher stops first, so a config edit during the drain starts nothing. The children go last, once no request needs them.
  stopOnSignals(httpServer, { before: () => store.close(), after: () => manager.stopAll() });
}

main().catch((err: unknown) => {
  console.error('[server] could not start:', err);
  process.exit(1);
});
