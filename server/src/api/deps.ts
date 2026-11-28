import type { ConfigState, ConfigStore } from '../config/store.ts';
import { errorMessage } from '../core/errors.ts';
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

/** What a reconcile reads the desired state from, and the gateway it reconciles. */
export interface ConfigToApply {
  store: Pick<ConfigStore, 'getServers' | 'getWorkspaces'>;
  manager: Pick<GatewayManager, 'reconcile'>;
}

/**
 * Reconcile the gateway's instances to the desired state the store holds right now.
 *
 * @param deps.store - Read for the current servers and workspaces.
 * @param deps.manager - The gateway to reconcile.
 *
 * @remarks
 * After a store write this is a barrier, not a second reconcile: the write's `change` already started one (see
 * `reconcileOnChange`), the pool runs reconciles one after another, and this one finds nothing left to change. A route
 * awaits it when what it answers, or does next, needs the gateway settled: a server's status after an install, a
 * closed child before its install directory is removed.
 */
export function applyConfig({ store, manager }: ConfigToApply): Promise<void> {
  return manager.reconcile(store.getServers(), store.getWorkspaces());
}

/** What `reconcileOnChange` listens to, and the gateway it reconciles. */
export interface ConfigToFollow {
  store: Pick<ConfigStore, 'on' | 'off'>;
  manager: Pick<GatewayManager, 'reconcile'>;
}

/**
 * Reconciles the gateway on every store `change`: each store write, and each `reload()` after a direct table write
 * (the generated GraphQL mutations), emits one.
 *
 * @param deps.store - The store whose changes are followed.
 * @param deps.manager - The gateway to reconcile.
 * @returns Stops following.
 *
 * @remarks
 * The reconcile is not awaited, since an event has no caller to hand a failure to; it is logged instead. Whoever needs
 * the gateway settled awaits `applyConfig` after the write.
 */
export function reconcileOnChange({ store, manager }: ConfigToFollow): () => void {
  const onChange = (state: ConfigState) => {
    console.log('[config] changed, reconciling servers');
    manager.reconcile(state.servers, state.workspaces).catch((err: unknown) => {
      console.warn(`[config] reconcile after a config change failed: ${errorMessage(err)}`);
    });
  };
  store.on('change', onChange);
  return () => {
    store.off('change', onChange);
  };
}
