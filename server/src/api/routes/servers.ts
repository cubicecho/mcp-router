import {
  activityResponseSchema,
  HttpStatus,
  installRequestSchema,
  type OAuthStartResponse,
  oauthStartRequestSchema,
  type ServerConfig,
  type ServerStatus,
  updateServerRequestSchema,
} from '@mcp-router/shared';
import { Router } from 'express';
import { applyServerUpdate } from '../../config/server-update.ts';
import { conflict, notFound } from '../../core/errors.ts';
import { listServerPrompts, listServerResources, listServerTools } from '../../gateway/listings.ts';
import { buildInstalledConfig, resolveServerName, uninstall } from '../../installer/installer.ts';
import { registerUiCallRoutes } from '../calls.ts';
import { type ApiDeps, applyConfig } from '../deps.ts';

/**
 * Builds installed-server CRUD plus its capability listings and test calls, mounted at /api/servers.
 *
 * @param deps.store - Holds the server configs.
 * @param deps.manager - Reports status and reaches the running servers.
 * @param deps.registryClient - Looks up registry entries for an install.
 * @param deps.dataDir - Where packages are installed and removed.
 * @param deps.oauth - Signs remote servers in and out.
 * @returns The router, with paths relative to /api/servers.
 */
export function createServerRoutes({ store, manager, registryClient, dataDir, oauth }: ApiDeps): Router {
  const router = Router();

  const installerDeps = {
    dataDir,
    registryClient,
    getRegistry: (name: string) => store.getRegistry(name),
  };

  const requireServer = (name: string): ServerConfig => {
    const config = store.getServer(name);
    if (!config) {
      throw notFound(`Unknown server "${name}"`);
    }
    return config;
  };

  const requireStatus = (name: string): ServerStatus => {
    const status = manager.status(requireServer(name).name);
    if (!status) {
      throw notFound(`Unknown server "${name}"`);
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
      throw conflict(`Server "${name}" already exists`);
    }
    const config = await buildInstalledConfig({ ...request, name }, installerDeps);
    await store.saveServer(config);
    await applyConfig({ store, manager });
    res.status(HttpStatus.Created).json(requireStatus(config.name));
  });

  router.get('/:name', (req, res) => {
    res.json(requireStatus(req.params.name));
  });

  router.patch('/:name', async (req, res) => {
    const name = req.params.name;
    const next = applyServerUpdate(requireServer(name), updateServerRequestSchema.parse(req.body));
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
    oauth.forget(name);
    await uninstall(dataDir, name);
    res.status(HttpStatus.NoContent).end();
  });

  // The sign-in a remote server asks for: start it here, finish it at /oauth/callback (see oauth/routes.ts).
  router.post('/:name/oauth/start', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    const { origin } = oauthStartRequestSchema.parse(req.body);
    const result: OAuthStartResponse = await oauth.start(name, origin);
    res.json(result);
  });

  // Whether a remote server wants a sign-in, asked without a token; the add dialog calls it after an install.
  router.post('/:name/oauth/check', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    await oauth.check(name);
    res.json(requireStatus(name));
  });

  router.delete('/:name/oauth', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    await oauth.signOut(name);
    res.json(requireStatus(name));
  });

  router.post('/:name/restart', async (req, res) => {
    const name = req.params.name;
    requireServer(name);
    await manager.restart(name);
    res.json(requireStatus(name));
  });

  // Every listing drains all pages, so a downstream that paginates doesn't silently lose items (or, for tools,
  // report a wrong count) past page 1. A downstream that lacks resources/prompts lists none.
  router.get('/:name/tools', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    res.json({ tools: await listServerTools(manager, name) });
  });

  router.get('/:name/resources', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    res.json(await listServerResources(manager, name));
  });

  router.get('/:name/prompts', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    res.json({ prompts: await listServerPrompts(manager, name) });
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
    res.status(HttpStatus.NoContent).end();
  });

  return router;
}
