import type { ConfigStore } from '../config/store.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import type { RegistryClient } from '../registry/client.ts';

/** Everything the REST routes are built over; each route module takes the whole set. */
export interface ApiDeps {
  store: ConfigStore;
  manager: GatewayManager;
  registryClient: RegistryClient;
  dataDir: string;
}

/** Reconcile the gateway's instances to the desired state the store holds right now. */
export function applyConfig({ store, manager }: Pick<ApiDeps, 'store' | 'manager'>): Promise<void> {
  return manager.reconcile(store.getServers(), store.getWorkspaces());
}
