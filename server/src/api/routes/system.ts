import type { RouterStatus } from '@mcp-router/shared';
import { MS_PER_SECOND, updateSettingsRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { effectiveAuth } from '../../auth/middleware.ts';
import { SERVER_VERSION } from '../../core/version.ts';
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
    const status: RouterStatus = {
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / MS_PER_SECOND),
      serverCount: store.getServers().length,
      runningCount: manager.runningCount(),
      authEnabled: effectiveAuth(store.getSettings()).enabled,
      idleTimeoutMs: store.getSettings().idleTimeoutMs,
    };
    res.json(status);
  });

  router.patch('/settings', async (req, res) => {
    const patch = updateSettingsRequestSchema.parse(req.body);
    const next = await store.updateSettings(patch);
    // The global idle timeout is resolved onto each server's row when the pool is
    // reconciled, so an edited one only reaches the running children through one.
    await applyConfig({ store, manager });
    res.json({ idleTimeoutMs: next.idleTimeoutMs });
  });

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    await manager.reconcile(state.servers, state.workspaces);
    res.json({ reloaded: true, serverCount: state.servers.length });
  });

  return router;
}
