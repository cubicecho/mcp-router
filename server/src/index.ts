import path from 'node:path';
import { buildApp } from './app.ts';
import { authDisabledByEnv } from './auth.ts';
import { ConfigStore } from './config/store.ts';
import { GatewayManager } from './gateway/manager.ts';

async function main(): Promise<void> {
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();

  const manager = new GatewayManager(() => store.getSettings());
  manager.reconcile(store.getServers(), store.getProjects());
  store.on('change', (state) => {
    console.log('Config changed on disk; reconciling servers');
    manager.reconcile(state.servers, state.projects);
  });
  store.startWatching();

  const app = buildApp({ store, manager });
  const port = Number(process.env.PORT ?? store.getSettings().port);
  // Unset binds all interfaces (Docker/LAN); set HOST=127.0.0.1 to restrict to localhost.
  const host = process.env.HOST ?? store.getSettings().host;
  const onListen = () => {
    console.log(`mcp-router listening on http://${host ?? 'localhost'}:${port} (data dir: ${dataDir})`);
    const settings = store.getSettings();
    if (authDisabledByEnv()) {
      console.log('Auth: disabled (SECURE_LOCAL_NET env var) — /api and /mcp are open on this network');
    } else if (!settings.authEnabled) {
      console.log('Auth: disabled (authEnabled: false in settings.json)');
    } else if (process.env.MCP_ROUTER_TOKEN) {
      console.log('Auth: bearer token from MCP_ROUTER_TOKEN env var (overrides settings.json)');
    } else {
      console.log(`Auth: bearer token from ${path.join(dataDir, 'config/settings.json')}:\n  ${settings.authToken}`);
    }
  };
  const httpServer = host ? app.listen(port, host, onListen) : app.listen(port, onListen);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down`);
    httpServer.close();
    Promise.allSettled([store.close(), manager.stopAll()]).then(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
