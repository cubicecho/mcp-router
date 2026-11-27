import { updateSettingsRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { routerStatus } from '../../gateway/router-status.ts';
import { type ApiDeps, applyConfig } from '../deps.ts';

/**
 * Builds the router-wide endpoints: status, global settings, and a config reload.
 *
 * @param deps.store - Holds the settings and is what a reload re-reads.
 * @param deps.manager - Reconciled after a settings change or a reload.
 * @returns The router, with paths relative to /api; uptime counts from this call.
 */
export function createSystemRoutes({ store, manager }: ApiDeps): Router {
  const startedAt = Date.now();
  const router = Router();

  router.get('/status', (_req, res) => {
    const status = routerStatus(store, manager, startedAt);
    res.json(status);
  });

  router.patch('/settings', async (req, res) => {
    const { publicUrl, ...patch } = updateSettingsRequestSchema.parse(req.body);
    // null clears the address: an absent key, so the schema reads it as unset.
    const next = await store.updateSettings(
      publicUrl === undefined ? patch : { ...patch, publicUrl: publicUrl === null ? undefined : publicUrl },
    );
    // The global idle timeout is resolved onto each server's row when the pool is
    // reconciled, so an edited one only reaches the running children through one.
    await applyConfig({ store, manager });
    res.json({
      idleTimeoutMs: next.idleTimeoutMs,
      ...(next.publicUrl ? { publicUrl: next.publicUrl } : {}),
      lanAdvertise: next.lanAdvertise,
      lanDiscovery: next.lanDiscovery,
    });
  });

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    await manager.reconcile(state.servers, state.workspaces);
    res.json({ reloaded: true, serverCount: state.servers.length });
  });

  return router;
}
