import type { RouterStatus } from '@mcp-router/shared';
import { MS_PER_SECOND, updateSettingsRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { effectiveAuth } from '../../auth.ts';
import { SERVER_VERSION } from '../../version.ts';
import { type ApiDeps, applyConfig } from '../deps.ts';

/** Router-wide endpoints: status, global settings, and a config reload. */
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
