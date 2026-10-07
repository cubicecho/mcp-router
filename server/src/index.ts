import path from 'node:path';
import { buildApp } from './app.ts';
import {
  authDisabledByEnv,
  dataDir as envDataDir,
  envToken,
  listenHost,
  listenPort,
  refusePlaceholderToken,
} from './config/env.ts';
import { ConfigStore } from './config/store.ts';
import { errorMessage } from './errors.ts';
import { GatewayManager } from './gateway/manager.ts';
import { tuneInbound } from './http-tuning.ts';
import { stopOnSignals } from './shutdown.ts';

async function main(): Promise<void> {
  refusePlaceholderToken();
  const dataDir = envDataDir();
  const store = new ConfigStore(dataDir);
  await store.init();

  const manager = new GatewayManager(() => store.getSettings());
  await manager.reconcile(store.getServers(), store.getWorkspaces());
  store.on('change', (state) => {
    console.log('Config changed on disk; reconciling servers');
    manager.reconcile(state.servers, state.workspaces).catch((err: unknown) => {
      console.warn(`Reconcile after config change failed: ${errorMessage(err)}`);
    });
  });
  store.startWatching();

  const app = buildApp({ store, manager });
  const port = listenPort(store.getSettings().port);
  // Unset binds all interfaces (Docker/LAN); set HOST=127.0.0.1 to restrict to localhost.
  const host = listenHost(store.getSettings().host);
  const onListen = () => {
    console.log(`mcp-router listening on http://${host ?? 'localhost'}:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    if (authDisabledByEnv()) {
      console.log('Auth: disabled (SECURE_LOCAL_NET env var) — /api and /mcp are open on this network');
    } else if (settings.authEnabled === false) {
      console.log('Auth: disabled (authEnabled: false in settings.json)');
    } else if (envToken() !== undefined) {
      console.log('Auth: bearer token from MCP_ROUTER_TOKEN env var (overrides settings.json)');
    } else {
      console.log(`Auth: bearer token from ${path.join(dataDir, 'config/settings.json')}:\n  ${settings.authToken}`);
    }
  };
  const httpServer = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  tuneInbound(httpServer);

  // The watcher stops first, so a config edit during the drain starts nothing. The children go last, once no request needs them.
  stopOnSignals(httpServer, { before: () => store.close(), after: () => manager.stopAll() });
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
