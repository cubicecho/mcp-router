import path from 'node:path';
import { buildApp } from './app.ts';
import { ConfigStore } from './config/store.ts';
import { GatewayManager } from './gateway/manager.ts';

async function main(): Promise<void> {
  const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
  const store = new ConfigStore(dataDir);
  await store.init();

  const manager = new GatewayManager(() => store.getSettings());
  manager.reconcile(store.getServers());
  store.on('change', (state) => {
    console.log('Config changed on disk; reconciling servers');
    manager.reconcile(state.servers);
  });
  store.startWatching();

  const app = buildApp({ store, manager });
  const port = Number(process.env.PORT ?? store.getSettings().port);
  const httpServer = app.listen(port, () => {
    console.log(`mcp-router listening on http://localhost:${port} (data dir: ${dataDir})`);
  });

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
