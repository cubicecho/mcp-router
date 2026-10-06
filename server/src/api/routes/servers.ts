import { listAllTools } from '@cubicecho/agent-mcp-pool';
import type { ServerConfig, ServerStatus } from '@mcp-router/shared';
import { activityResponseSchema, installRequestSchema, updateServerRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import { errorMessage, HttpError } from '../../errors.ts';
import { emptyOnMissing } from '../../gateway/capability.ts';
import { listAllPrompts, listAllResources, listAllResourceTemplates } from '../../gateway/pagination.ts';
import { buildServerConfig, resolveServerName, uninstall } from '../../installer/installer.ts';
import { registerUiCallRoutes } from '../calls.ts';
import { type ApiDeps, applyConfig } from '../deps.ts';

/** Installed-server CRUD plus its capability listings and test calls, mounted at /api/servers. */
export function createServerRoutes({ store, manager, registryClient, dataDir }: ApiDeps): Router {
  const router = Router();

  const installerDeps = {
    dataDir,
    registryClient,
    getRegistry: (name: string) => store.getRegistry(name),
  };

  const requireServer = (name: string): ServerConfig => {
    const config = store.getServer(name);
    if (!config) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    return config;
  };

  const requireStatus = (name: string): ServerStatus => {
    const status = manager.status(requireServer(name).name);
    if (!status) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    return status;
  };

  router.get('/', (_req, res) => {
    res.json(manager.statusAll());
  });

  router.post('/', async (req, res) => {
    const request = installRequestSchema.parse(req.body);
    const name = resolveServerName(request);
    if (store.getServer(name)) {
      throw new HttpError(409, `Server "${name}" already exists`);
    }
    const config = await buildServerConfig({ ...request, name }, installerDeps);
    await store.saveServer(config);
    await applyConfig({ store, manager });
    res.status(201).json(requireStatus(config.name));
  });

  router.get('/:name', (req, res) => {
    res.json(requireStatus(req.params.name));
  });

  router.patch('/:name', async (req, res) => {
    const name = req.params.name;
    const existing = requireServer(name);
    // The request schema is a plain object, so an omitted field is an absent key
    // (never an explicit undefined) and spreads as "leave it alone". Only
    // idleTimeoutMs needs a hand: null means "clear the override", not "set null".
    const { idleTimeoutMs, ...fields } = updateServerRequestSchema.parse(req.body);
    const next: ServerConfig = { ...existing, ...fields };
    if (idleTimeoutMs === null) {
      delete next.idleTimeoutMs;
    } else if (idleTimeoutMs !== undefined) {
      next.idleTimeoutMs = idleTimeoutMs;
    }
    await store.saveServer(next);
    await applyConfig({ store, manager });
    res.json(requireStatus(name));
  });

  router.delete('/:name', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    await store.deleteServer(name);
    // Before the uninstall, not after: the reconcile is what closes the child,
    // and removing its install directory out from under a live process is how a
    // half-deleted server with a file still open happens.
    await applyConfig({ store, manager });
    await uninstall(dataDir, name);
    res.status(204).end();
  });

  router.post('/:name/restart', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    await manager.restart(name);
    res.json(requireStatus(name));
  });

  // Every listing drains all pages (listAll*), so a downstream that paginates
  // doesn't silently lose items — or, for tools, report a wrong count — past
  // page 1.
  router.get('/:name/tools', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const tools = await manager.withClient(name, listAllTools);
    manager.recordToolCount(name, tools.length);
    res.json({ tools });
  });

  // A downstream that lacks resources/prompts answers "method not found" (or our
  // client refuses to send). That's not an error for a listing endpoint — it's an
  // empty list, so the UI shows "none reported" rather than a failure.
  router.get('/:name/resources', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const [resources, templates] = await Promise.all([
      emptyOnMissing(() => manager.withClient(name, listAllResources)),
      // Templates are a supplementary sub-listing: a genuine failure here must not
      // discard a successful resources list, so it is best-effort (missing → null
      // via emptyOnMissing; any other error → warn + null) rather than fatal to the
      // whole endpoint.
      emptyOnMissing(() => manager.withClient(name, listAllResourceTemplates)).catch((cause: unknown) => {
        console.warn(`Listing resource templates for "${name}" failed: ${errorMessage(cause)}`);
        return null;
      }),
    ]);
    res.json({
      resources: resources ?? [],
      resourceTemplates: templates ?? [],
    });
  });

  router.get('/:name/prompts', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const prompts = await emptyOnMissing(() => manager.withClient(name, listAllPrompts));
    res.json({ prompts: prompts ?? [] });
  });

  registerUiCallRoutes(router, manager, (name) => {
    requireStatus(name);
    return (_kind, requested) => ({ key: name, target: requested });
  });

  router.get('/:name/activity', (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    res.json(activityResponseSchema.parse({ entries: manager.getActivity(name) }));
  });

  router.delete('/:name/activity', (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    manager.clearActivity(name);
    res.status(204).end();
  });

  return router;
}
