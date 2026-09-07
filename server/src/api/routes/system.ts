import type { RouterStatus } from '@mcp-router/shared';
import { updateSettingsRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { authDisabledByEnv } from '../../auth.ts';
import { SERVER_VERSION } from '../../version.ts';
import type { ApiDeps } from '../deps.ts';

/** Router-wide endpoints: status, global settings, and a config reload. */
export function createSystemRoutes({ store, manager }: ApiDeps): Router {
  const startedAt = Date.now();
  const router = Router();

  router.get('/status', (_req, res) => {
    const status: RouterStatus = {
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      serverCount: store.getServers().length,
      runningCount: manager.runningCount(),
      authEnabled: store.getSettings().authEnabled && !authDisabledByEnv(),
      idleTimeoutMs: store.getSettings().idleTimeoutMs,
    };
    res.json(status);
  });

  // --- settings ---

  router.patch('/settings', async (req, res) => {
    const patch = updateSettingsRequestSchema.parse(req.body);
    const next = await store.updateSettings(patch);
    // The global idle timeout is resolved onto each server's row when the pool is
    // reconciled, so an edited one only reaches the running children through one.
    await manager.reconcile(store.getServers(), store.getWorkspaces());
    res.json({ idleTimeoutMs: next.idleTimeoutMs });
  });

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    await manager.reconcile(state.servers, state.workspaces);
    res.json({ reloaded: true, serverCount: state.servers.length });
  });

  return router;
}
