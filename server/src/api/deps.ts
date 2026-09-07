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
