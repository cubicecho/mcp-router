import { MS_PER_SECOND, type RouterStatus, type ServerConfig, type SettingsFile } from '@mcp-router/shared';
import { effectiveAuth } from '../auth/middleware.ts';
import { SERVER_VERSION } from '../core/version.ts';
import type { GatewayManager } from './manager.ts';

/** What the router's status is read from: the config in force. */
export interface StatusSource {
  getSettings(): SettingsFile;
  getServers(): ServerConfig[];
}

/**
 * Reads the router's own status, as both management doors answer it.
 *
 * @param store - The config in force.
 * @param manager - Counts the running servers.
 * @param startedAt - When the router started, in ms since the epoch; uptime counts from it.
 * @param [now] - The time now, in ms since the epoch.
 * @returns The status.
 */
export function routerStatus(
  store: StatusSource,
  manager: Pick<GatewayManager, 'runningCount'>,
  startedAt: number,
  now: number = Date.now(),
): RouterStatus {
  const settings = store.getSettings();
  return {
    version: SERVER_VERSION,
    uptimeSeconds: Math.floor((now - startedAt) / MS_PER_SECOND),
    serverCount: store.getServers().length,
    runningCount: manager.runningCount(),
    authEnabled: effectiveAuth(settings).enabled,
    idleTimeoutMs: settings.idleTimeoutMs,
    ...(settings.publicUrl ? { publicUrl: settings.publicUrl } : {}),
    instanceId: settings.instanceId ?? '',
    lanAdvertise: settings.lanAdvertise,
    lanDiscovery: settings.lanDiscovery,
  };
}
