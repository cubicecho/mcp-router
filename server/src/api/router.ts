import type { ProjectConfig, ProjectStatus, RouterStatus, ServerConfig, ServerStatus } from '@mcp-router/shared';
import {
  activityResponseSchema,
  createProjectRequestSchema,
  createRegistryRequestSchema,
  installRequestSchema,
  projectConfigSchema,
  promptGetRequestSchema,
  resourceReadRequestSchema,
  serverNameSchema,
  slugify,
  toolCallRequestSchema,
  updateProjectRequestSchema,
  updateServerRequestSchema,
  updateSettingsRequestSchema,
} from '@mcp-router/shared';
import { Router } from 'express';
import { authDisabledByEnv } from '../auth.ts';
import type { ConfigStore } from '../config/store.ts';
import { errorMessage, HttpError } from '../errors.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import { lacksCapability, toolCallFailed, toolErrorText } from '../gateway/proxy.ts';
import { buildServerConfig, deriveServerName, uninstall } from '../installer/installer.ts';
import type { RegistryClient } from '../registry/client.ts';
import { SERVER_VERSION } from '../version.ts';

/** Run a downstream list call, mapping a "capability not supported" failure to null. */
async function emptyOnMissing<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (cause) {
    if (lacksCapability(cause)) {
      return null;
    }
    throw cause;
  }
}

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

  // Connect (spawning if needed) for a listing/call endpoint. A missing server
  // surfaces as 404; any other connect failure as 502 with the downstream detail.
  const connect = async (name: string): Promise<Awaited<ReturnType<GatewayManager['getClient']>>> => {
    try {
      return await manager.getClient(name);
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 404) {
        throw cause;
      }
      const detail = cause instanceof HttpError ? (cause.detail ?? cause.message) : String(cause);
      throw new HttpError(502, `Failed to connect to server "${name}"`, detail, { cause });
    }
  };

  /**
   * Run one downstream call invoked from the UI (tool call, resource read, prompt
   * get) and record it to the activity log under via 'ui', exactly like proxied
   * calls. A thrown downstream error becomes a 502; `detectFailure` lets a result
   * that resolves-but-signals-failure (e.g. a tool's `isError`) be logged as not-ok.
   */
  const runUiCall = async (
    name: string,
    ctx: {
      method: string;
      target: string;
      params: unknown;
      failLabel: string;
      detectFailure?: (result: unknown) => string | null;
    },
    run: (client: Awaited<ReturnType<GatewayManager['getClient']>>) => Promise<unknown>,
  ): Promise<unknown> => {
    const client = await connect(name);
    const startedAt = Date.now();
    try {
      const result = await run(client);
      const failure = ctx.detectFailure?.(result) ?? null;
      manager.recordActivity(name, {
        at: new Date().toISOString(),
        via: 'ui',
        method: ctx.method,
        target: ctx.target,
        ok: failure === null,
        durationMs: Date.now() - startedAt,
        params: ctx.params,
        result,
        error: failure ?? undefined,
      });
      return result;
    } catch (cause) {
      manager.recordActivity(name, {
        at: new Date().toISOString(),
        via: 'ui',
        method: ctx.method,
        target: ctx.target,
        ok: false,
        durationMs: Date.now() - startedAt,
        params: ctx.params,
        error: errorMessage(cause),
      });
      throw new HttpError(502, ctx.failLabel, errorMessage(cause), { cause });
    }
  };

  // --- status ---

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
    res.json({ idleTimeoutMs: next.idleTimeoutMs });
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
    manager.reconcile(store.getServers(), store.getProjects());
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
    manager.reconcile(store.getServers(), store.getProjects());
    res.json(requireStatus(name));
  });

  router.delete('/servers/:name', async (req, res) => {
    const name = req.params.name;
    if (!store.getServer(name)) {
      throw new HttpError(404, `Unknown server "${name}"`);
    }
    await manager.stop(name);
    await store.deleteServer(name);
    manager.reconcile(store.getServers(), store.getProjects());
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
    const client = await connect(name);
    const result = await client.listTools();
    manager.recordToolCount(name, result.tools.length);
    res.json({ tools: result.tools });
  });

  // A downstream that lacks resources/prompts answers "method not found" (or our
  // client refuses to send). That's not an error for a listing endpoint — it's an
  // empty list, so the UI shows "none reported" rather than a failure.
  router.get('/servers/:name/resources', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const client = await connect(name);
    const [resources, templates] = await Promise.all([
      emptyOnMissing(() => client.listResources()),
      emptyOnMissing(() => client.listResourceTemplates()),
    ]);
    res.json({
      resources: resources?.resources ?? [],
      resourceTemplates: templates?.resourceTemplates ?? [],
    });
  });

  router.get('/servers/:name/prompts', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const client = await connect(name);
    const result = await emptyOnMissing(() => client.listPrompts());
    res.json({ prompts: result?.prompts ?? [] });
  });

  // Run one tool from the UI. Recorded to the activity log like proxied calls,
  // under via 'ui'. A tool that resolves with `isError: true` is logged not-ok.
  router.post('/servers/:name/tools/call', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const body = toolCallRequestSchema.parse(req.body);
    const result = await runUiCall(
      name,
      {
        method: 'tools/call',
        target: body.name,
        params: body,
        failLabel: `Tool "${body.name}" failed`,
        detectFailure: (r) => (toolCallFailed(r) ? toolErrorText(r) : null),
      },
      (client) => client.callTool({ name: body.name, arguments: body.arguments }),
    );
    res.json(result);
  });

  // Read one resource by URI from the UI. Works for a static resource's URI or a
  // concrete URI the caller expanded from a resource template.
  router.post('/servers/:name/resources/read', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const body = resourceReadRequestSchema.parse(req.body);
    const result = await runUiCall(
      name,
      { method: 'resources/read', target: body.uri, params: body, failLabel: `Resource "${body.uri}" failed to read` },
      (client) => client.readResource({ uri: body.uri }),
    );
    res.json(result);
  });

  // Get one prompt (with its arguments) from the UI.
  router.post('/servers/:name/prompts/get', async (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    const body = promptGetRequestSchema.parse(req.body);
    const result = await runUiCall(
      name,
      { method: 'prompts/get', target: body.name, params: body, failLabel: `Prompt "${body.name}" failed` },
      (client) => client.getPrompt({ name: body.name, arguments: body.arguments }),
    );
    res.json(result);
  });

  router.get('/servers/:name/activity', (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    res.json(activityResponseSchema.parse({ entries: manager.getActivity(name) }));
  });

  router.delete('/servers/:name/activity', (req, res) => {
    const name = req.params.name;
    requireStatus(name);
    manager.clearActivity(name);
    res.status(204).end();
  });

  // --- projects ---

  const projectPath = (slug: string): string => `/mcp/p/${slug}`;
  const toProjectStatus = (project: ProjectConfig): ProjectStatus => ({ ...project, path: projectPath(project.slug) });

  const requireProject = (slug: string): ProjectConfig => {
    const project = store.getProject(slug);
    if (!project) {
      throw new HttpError(404, `Unknown project "${slug}"`);
    }
    return project;
  };

  /** Every member must reference a server that currently exists. */
  const assertMembersExist = (members: Record<string, unknown> | undefined): void => {
    for (const name of Object.keys(members ?? {})) {
      if (!store.getServer(name)) {
        throw new HttpError(400, `Unknown server "${name}" in project members`);
      }
    }
  };

  const requireValidSlug = (slug: string): string => {
    const parsed = serverNameSchema.safeParse(slug);
    if (!parsed.success) {
      throw new HttpError(400, `Invalid project slug "${slug}"`, 'derive a name that yields a valid URL slug');
    }
    return parsed.data;
  };

  router.get('/projects', (_req, res) => {
    res.json(store.getProjects().map(toProjectStatus));
  });

  router.post('/projects', async (req, res) => {
    const request = createProjectRequestSchema.parse(req.body);
    const slug = requireValidSlug(request.slug ?? slugify(request.name));
    if (store.getProject(slug)) {
      throw new HttpError(409, `Project "${slug}" already exists`);
    }
    assertMembersExist(request.members);
    const config = projectConfigSchema.parse({
      name: request.name,
      slug,
      enabled: request.enabled ?? true,
      description: request.description,
      members: request.members ?? {},
    });
    await store.saveProject(config);
    manager.reconcile(store.getServers(), store.getProjects());
    res.status(201).json(toProjectStatus(config));
  });

  router.get('/projects/:slug', (req, res) => {
    res.json(toProjectStatus(requireProject(req.params.slug)));
  });

  router.patch('/projects/:slug', async (req, res) => {
    const existing = requireProject(req.params.slug);
    const update = updateProjectRequestSchema.parse(req.body);
    assertMembersExist(update.members);
    // Auto-slug: renaming re-derives the slug (and thus the URL). Keep the old
    // slug when the name is unchanged so member-only edits never move the URL.
    const name = update.name ?? existing.name;
    const slug = update.name !== undefined ? requireValidSlug(slugify(name)) : existing.slug;
    if (slug !== existing.slug && store.getProject(slug)) {
      throw new HttpError(409, `Project "${slug}" already exists`);
    }
    const next = projectConfigSchema.parse({
      ...existing,
      name,
      slug,
      enabled: update.enabled ?? existing.enabled,
      description: update.description !== undefined ? update.description : existing.description,
      members: update.members ?? existing.members,
    });
    await store.saveProject(next);
    if (slug !== existing.slug) {
      await store.deleteProject(existing.slug);
    }
    manager.reconcile(store.getServers(), store.getProjects());
    res.json(toProjectStatus(next));
  });

  router.delete('/projects/:slug', async (req, res) => {
    requireProject(req.params.slug);
    await store.deleteProject(req.params.slug);
    manager.reconcile(store.getServers(), store.getProjects());
    res.status(204).end();
  });

  // --- reload ---

  router.post('/reload', async (_req, res) => {
    const state = await store.reload();
    manager.reconcile(state.servers, state.projects);
    res.json({ reloaded: true, serverCount: state.servers.length });
  });

  return router;
}
