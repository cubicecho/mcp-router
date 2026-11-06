import type { ConfigStore } from '../config/store.ts';
import type { LanServers } from '../discovery/lan-servers.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import type { OAuthService } from '../oauth/service.ts';
import type { RegistryClient } from '../registry/client.ts';

/** Everything the REST routes are built over; each route module takes the whole set. */
export interface ApiDeps {
  store: ConfigStore;
  manager: GatewayManager;
  registryClient: RegistryClient;
  /** The data directory; installed packages live under it. */
  dataDir: string;
  /** OAuth sign-in for remote servers. */
  oauth: OAuthService;
  /** The servers found on the local network. */
  lanServers: LanServers;
}

/**
 * Reconcile the gateway's instances to the desired state the store holds right now.
 *
 * @param deps.store - Read for the current servers and workspaces.
 * @param deps.manager - The gateway to reconcile.
 */
export function applyConfig({ store, manager }: Pick<ApiDeps, 'store' | 'manager'>): Promise<void> {
  return manager.reconcile(store.getServers(), store.getWorkspaces());
}
