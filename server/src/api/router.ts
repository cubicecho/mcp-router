import type { RouterStatus, ServerConfig, ServerStatus } from '@mcp-router/shared';
import { createRegistryRequestSchema, installRequestSchema, updateServerRequestSchema } from '@mcp-router/shared';
import { Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { HttpError } from '../errors.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import { buildServerConfig, deriveServerName, uninstall } from '../installer/installer.ts';
import type { RegistryClient } from '../registry/client.ts';
import { SERVER_VERSION } from '../version.ts';

export interface ApiDeps {
  store: ConfigStore;
  manager: GatewayManager;
  registryClient: RegistryClient;
  dataDir: string;
}

export function createApiRouter(deps: ApiDeps): Router {
  const { store, manager, registryClient, dataDir } = deps;
  const startedAt = Date.now();
  const router = Router();

  const installerDeps = {
    dataDir,
    registryClient,
    getRegistry: (name: string) => store.getRegistry(name),
  };

  const requireRegistry = (name: string) => {
    const registry = store.getRegistry(name);
    if (!registry) {
      throw new HttpError(404, `Unknown registry "${name}"`);
    }
    return registry;
  };

  const requireStatus = (name: string): ServerStatus => {
    const status = manager.status(name);
    if (!status || !store.getServer(name)) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    return status;
  };

  // --- status ---

  router.get('/status', (_req, res) => {
    const status: RouterStatus = {
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      serverCount: store.getServers().length,
      runningCount: manager.runningCount(),
      authEnabled: store.getSettings().authEnabled,
    };
    res.json(status);
  });

  // --- registries ---

  router.get('/registries', (_req, res) => {
    res.json(store.getRegistries());
  });

  router.post('/registries', async (req, res) => {
    const registry = createRegistryRequestSchema.parse(req.body);
    await store.addRegistry(registry);
    res.status(201).json(registry);
  });

  router.delete('/registries/:name', async (req, res) => {
    await store.removeRegistry(req.params.name);
    res.status(204).end();
  });

  router.get('/registries/:name/servers', async (req, res) => {
    const registry = requireRegistry(req.params.name);
    const { search, cursor, limit } = req.query;
    const result = await registryClient.listServers(registry, {
      search: typeof search === 'string' ? search : undefined,
      cursor: typeof cursor === 'string' ? cursor : undefined,
      limit: typeof limit === 'string' ? Number(limit) || undefined : undefined,
    });
    res.json(result);
  });

  // Registry server names contain slashes (io.github.owner/repo): accept both
  // URL-encoded (%2F) and raw-slash forms via a named wildcard.
  router.get('/registries/:name/servers/*serverName', async (req, res) => {
    const registry = requireRegistry(req.params.name);
    const segments = req.params.serverName as unknown as string[];
    const serverName = Array.isArray(segments) ? segments.join('/') : String(segments);
    const entry = await registryClient.getServer(registry, serverName);
    res.json(entry);
  });

  // --- servers ---

  router.get('/servers', (_req, res) => {
    res.json(manager.statusAll());
  });

  router.post('/servers', async (req, res) => {
    const request = installRequestSchema.parse(req.body);
    const name =
      request.name ??
      (request.source.type === 'registry'
        ? deriveServerName(request.source.serverName)
        : request.source.type === 'npm'
          ? deriveServerName(request.source.package)
          : undefined);
    if (!name) {
      throw new HttpError(400, 'A "name" is required when installing a remote server');
    }
    if (store.getServer(name)) {
      throw new HttpError(409, `Server "${name}" already exists`);
    }
    const config = await buildServerConfig({ ...request, name }, installerDeps);
    await store.saveServer(config);
    manager.reconcile(store.getServers());
    res.status(201).json(requireStatus(config.name));
  });

  router.get('/servers/:name', (req, res) => {
    res.json(requireStatus(req.params.name));
  });

  router.patch('/servers/:name', async (req, res) => {
    const name = req.params.name;
    const existing = store.getServer(name);
    if (!existing) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    const update = updateServerRequestSchema.parse(req.body);
    const next: ServerConfig = { ...existing };
    if (update.displayName !== undefined) {
      next.displayName = update.displayName;
    }
    if (update.description !== undefined) {
      next.description = update.description;
    }
    if (update.enabled !== undefined) {
      next.enabled = update.enabled;
    }
    if (update.env !== undefined) {
      next.env = update.env;
    }
    if (update.transport !== undefined) {
      next.transport = update.transport;
    }
    if (update.idleTimeoutMs !== undefined) {
      if (update.idleTimeoutMs === null) {
        delete next.idleTimeoutMs;
      } else {
        next.idleTimeoutMs = update.idleTimeoutMs;
      }
    }
    await store.saveServer(next);
    manager.reconcile(store.getServers());
    res.json(requireStatus(name));
  });

  router.delete('/servers/:name', async (req, res) => {
    const name = req.params.name;
    if (!store.getServer(name)) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    await manager.stop(name);
    await store.deleteServer(name);
    manager.reconcile(store.getServers());
    await uninstall(dataDir, name);
    res.status(204).end();
  });

  router.post('/servers/:name/restart', async (req, res) => {
    const name = req.params.name;
    if (!store.getServer(name)) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    await manager.stop(name);
    await manager.getClient(name);
    res.json(requireStatus(name));
  });

  router.get('/servers/:name/tools', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    let client: Awaited<ReturnType<GatewayManager['getClient']>>;
    try {
      client = await manager.getClient(name);
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 404) {
        throw cause;
      }
      const detail = cause instanceof HttpError ? (cause.detail ?? cause.message) : String(cause);
      throw new HttpError(502, `Failed to connect to server "${name}"`, detail, { cause });
    }
    const result = await client.listTools();
    manager.recordToolCount(name, result.tools.length);
    res.json({ tools: result.tools });
  });

  // --- reload ---

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    manager.reconcile(state.servers);
    res.json({ reloaded: true, serverCount: state.servers.length });
  });

  return router;
}
