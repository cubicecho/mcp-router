import {
  activityResponseSchema,
  createWorkspaceRequestSchema,
  HttpStatus,
  serverNameSchema,
  slugify,
  updateWorkspaceRequestSchema,
  type WorkspaceConfig,
  type WorkspaceStatus,
  workspaceConfigSchema,
} from '@mcp-router/shared';
import { Router } from 'express';
import { badInput, conflict, notFound } from '../../core/errors.ts';
import {
  clearWorkspaceActivity,
  listWorkspacePrompts,
  listWorkspaceResources,
  listWorkspaceTools,
  workspaceActivity,
  workspaceEndpointScope,
} from '../../gateway/listings.ts';
import { splitNamespacedName } from '../../gateway/naming.ts';
import { registerUiCallRoutes } from '../calls.ts';
import { type ApiDeps, applyConfig } from '../deps.ts';

/**
 * Builds workspace CRUD plus the aggregate's capability listings and test calls, mounted at /api/workspaces.
 *
 * @param deps.store - Holds the workspace and server configs.
 * @param deps.manager - Reaches each member's workspace-scoped instance.
 * @returns The router, with paths relative to /api/workspaces.
 */
export function createWorkspaceRoutes({ store, manager }: ApiDeps): Router {
  const router = Router();

  const workspacePath = (slug: string): string => `/mcp/w/${slug}`;
  const toWorkspaceStatus = (workspace: WorkspaceConfig): WorkspaceStatus => ({
    ...workspace,
    path: workspacePath(workspace.slug),
  });

  const requireWorkspace = (slug: string): WorkspaceConfig => {
    const workspace = store.getWorkspace(slug);
    if (!workspace) {
      throw notFound(`Unknown workspace "${slug}"`);
    }
    return workspace;
  };

  /** Every member must reference a server that currently exists. */
  const assertMembersExist = (members: Record<string, unknown> | undefined): void => {
    for (const name of Object.keys(members ?? {})) {
      if (!store.getServer(name)) {
        throw badInput(`Unknown server "${name}" in workspace members`);
      }
    }
  };

  const requireValidSlug = (slug: string): string => {
    const parsed = serverNameSchema.safeParse(slug);
    if (parsed.success === false) {
      throw badInput(`Invalid workspace slug "${slug}"`, 'derive a name that yields a valid URL slug');
    }
    return parsed.data;
  };

  router.get('/', (_req, res) => {
    res.json(store.getWorkspaces().map(toWorkspaceStatus));
  });

  router.post('/', async (req, res) => {
    const request = createWorkspaceRequestSchema.parse(req.body);
    const slug = requireValidSlug(request.slug ?? slugify(request.name));
    if (store.getWorkspace(slug)) {
      throw conflict(`Workspace "${slug}" already exists`);
    }
    assertMembersExist(request.members);
    const config = workspaceConfigSchema.parse({
      name: request.name,
      slug,
      enabled: request.enabled ?? true,
      description: request.description,
      members: request.members ?? {},
    });
    await store.saveWorkspace(config);
    await applyConfig({ store, manager });
    res.status(HttpStatus.Created).json(toWorkspaceStatus(config));
  });

  router.get('/:slug', (req, res) => {
    res.json(toWorkspaceStatus(requireWorkspace(req.params.slug)));
  });

  router.patch('/:slug', async (req, res) => {
    const existing = requireWorkspace(req.params.slug);
    const update = updateWorkspaceRequestSchema.parse(req.body);
    assertMembersExist(update.members);
    // Auto-slug: renaming re-derives the slug (and thus the URL). Keep the old
    // slug when the name is unchanged so member-only edits never move the URL.
    const name = update.name ?? existing.name;
    const slug = update.name !== undefined ? requireValidSlug(slugify(name)) : existing.slug;
    if (slug !== existing.slug && store.getWorkspace(slug)) {
      throw conflict(`Workspace "${slug}" already exists`);
    }
    const next = workspaceConfigSchema.parse({
      ...existing,
      name,
      slug,
      enabled: update.enabled ?? existing.enabled,
      // An empty description clears it; one left out keeps the stored one.
      description: update.description === undefined ? existing.description : update.description || undefined,
      members: update.members ?? existing.members,
    });
    await store.saveWorkspace(next);
    if (slug !== existing.slug) {
      await store.deleteWorkspace(existing.slug);
    }
    await applyConfig({ store, manager });
    res.json(toWorkspaceStatus(next));
  });

  router.delete('/:slug', async (req, res) => {
    requireWorkspace(req.params.slug);
    await store.deleteWorkspace(req.params.slug);
    await applyConfig({ store, manager });
    res.status(HttpStatus.NoContent).end();
  });

  // These mirror the per-server capability endpoints but run against each member's workspace-scoped instance (so
  // per-workspace overrides apply), and present everything as the /mcp/w/:slug aggregate does: `<server>__`-namespaced.
  router.get('/:slug/tools', async (req, res) => {
    const workspace = requireWorkspace(req.params.slug);
    res.json({ tools: await listWorkspaceTools(manager, store, workspace) });
  });

  router.get('/:slug/resources', async (req, res) => {
    const workspace = requireWorkspace(req.params.slug);
    res.json(await listWorkspaceResources(manager, store, workspace));
  });

  router.get('/:slug/prompts', async (req, res) => {
    const workspace = requireWorkspace(req.params.slug);
    res.json({ prompts: await listWorkspacePrompts(manager, store, workspace) });
  });

  // A test call routes by its `<server>__` prefix back to the owning member's workspace instance.
  registerUiCallRoutes(router, manager, (slug) => {
    const scope = workspaceEndpointScope(requireWorkspace(slug), store);
    return (kind, requested) => {
      const split = splitNamespacedName(requested, scope.names());
      if (!split) {
        throw badInput(`Unknown ${kind} "${requested}" (expected <server>__<name>)`);
      }
      return { key: scope.keyFor(split.serverName), target: split.name };
    };
  });

  // Workspace activity merges every member instance's log, newest first.
  router.get('/:slug/activity', (req, res) => {
    const workspace = requireWorkspace(req.params.slug);
    res.json(activityResponseSchema.parse({ entries: workspaceActivity(manager, store, workspace) }));
  });

  router.delete('/:slug/activity', (req, res) => {
    clearWorkspaceActivity(manager, store, requireWorkspace(req.params.slug));
    res.status(HttpStatus.NoContent).end();
  });

  return router;
}
