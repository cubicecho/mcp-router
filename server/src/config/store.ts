import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import path from 'node:path';
import { hostSlug } from '@cubicecho/mcp-discovery';
import {
  type Registry,
  registrySchema,
  type ServerConfig,
  type SettingsFile,
  serverConfigSchema,
  settingsFileSchema,
  type WorkspaceConfig,
  workspaceConfigSchema,
} from '@mcp-router/shared';
import { asc, eq } from 'drizzle-orm';
import { effectiveAuth } from '../auth/middleware.ts';
import { CONFIG_DEFAULTS } from '../core/defaults.ts';
import { conflict, errorMessage, notFound } from '../core/errors.ts';
import type { DB } from '../db/client.ts';
import { registries } from '../db/tables/registries.ts';
import { servers } from '../db/tables/servers.ts';
import { SETTINGS_ROW_ID, type SettingsRow, settings } from '../db/tables/settings.ts';
import { workspaceMembers } from '../db/tables/workspace-members.ts';
import { workspaces } from '../db/tables/workspaces.ts';
import { seedDatabase } from './import.ts';
import {
  type NamedMemberRow,
  registryFromRow,
  registryToRow,
  serverFromRow,
  settingsFromRow,
  settingsToRow,
  workspaceFromRows,
} from './rows.ts';
import { upsertServer, upsertWorkspace } from './writes.ts';

/** The instance id written when the hostname has nothing usable in it. */
const FALLBACK_INSTANCE_ID = 'router';

/** Everything the database holds, as last loaded. */
export interface ConfigState {
  settings: SettingsFile;
  registries: Registry[];
  servers: ServerConfig[];
  workspaces: WorkspaceConfig[];
}

/** What a store reads and writes. */
export interface ConfigStoreDeps {
  db: DB;
  /** The data directory. On first boot the config files in its `config` folder are imported. */
  dataDir: string;
}

/**
 * Owns the router's config: the settings row and the registries, servers, workspaces and workspace_members tables.
 *
 * @remarks
 * Reads are served from memory, loaded by `init` and `reload`. Every write goes to the database first, then reloads
 * memory from it, then emits a typed 'change' event. Anything else that writes the tables calls `reload()` after it
 * commits, which emits 'change' too.
 */
export class ConfigStore extends EventEmitter<{ change: [ConfigState] }> {
  readonly dataDir: string;
  /** `<dataDir>/config`, where an older router kept its files. Read once, on first boot. */
  readonly configDir: string;

  private readonly db: DB;
  private settings: SettingsFile = settingsFileSchema.parse({});
  private registries: Registry[] = [];
  private servers = new Map<string, ServerConfig>();
  private workspaces = new Map<string, WorkspaceConfig>();

  /**
   * Holds the database; nothing is read or written until `init`.
   *
   * @param deps - The database, and the data directory.
   */
  constructor({ db, dataDir }: ConfigStoreDeps) {
    super();
    this.db = db;
    this.dataDir = dataDir;
    this.configDir = path.join(dataDir, 'config');
  }

  /** On an empty database, import the config files (or seed defaults), then load everything. */
  async init(): Promise<void> {
    const isEmpty = (await this.readSettingsRow()) === undefined;
    if (isEmpty) {
      await seedDatabase(this.db, this.configDir);
    }
    await this.loadAll();
  }

  /**
   * Re-reads everything from the database and emits 'change'. Whatever writes the tables directly calls this after
   * it commits.
   *
   * @returns The new state. Rejects when the settings row is invalid; an invalid server or workspace is logged and
   * skipped.
   */
  async reload(): Promise<ConfigState> {
    await this.loadAll();
    const state = this.snapshot();
    this.emit('change', state);
    return state;
  }

  /**
   * Reads everything held in memory at once.
   *
   * @returns The current state, with servers and workspaces sorted by name.
   */
  snapshot(): ConfigState {
    return {
      settings: this.settings,
      registries: this.registries,
      servers: this.getServers(),
      workspaces: this.getWorkspaces(),
    };
  }

  /**
   * Reads the settings.
   *
   * @returns The settings as last loaded or saved.
   */
  getSettings(): SettingsFile {
    return this.settings;
  }

  /**
   * Lists the registries.
   *
   * @returns The registries in the order they were added.
   */
  getRegistries(): Registry[] {
    return this.registries;
  }

  /**
   * Finds a registry.
   *
   * @param name - The registry's name.
   * @returns The registry, or undefined when there is none by that name.
   */
  getRegistry(name: string): Registry | undefined {
    return this.registries.find((r) => r.name === name);
  }

  /**
   * Lists the server configs.
   *
   * @returns A new array, sorted by name.
   */
  getServers(): ServerConfig[] {
    return [...this.servers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Finds a server config.
   *
   * @param name - The server's name.
   * @returns The config, or undefined when there is none by that name.
   */
  getServer(name: string): ServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * Merges a partial settings update and stores it.
   *
   * @param patch - The fields to change; the rest keep their values.
   * @returns The merged settings. Throws, changing nothing, when the result fails validation.
   */
  async updateSettings(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const next = settingsFileSchema.parse({ ...this.settings, ...patch });
    await this.writeSettings(next);
    await this.reload();
    return this.settings;
  }

  /**
   * Adds a registry.
   *
   * @param registry - The registry to add. Throws a 409 when its name is taken.
   */
  async addRegistry(registry: Registry): Promise<void> {
    if (this.getRegistry(registry.name)) {
      throw conflict(`Registry "${registry.name}" already exists`);
    }
    const parsed = registrySchema.parse(registry);
    await this.db.insert(registries).values(registryToRow(parsed));
    await this.reload();
  }

  /**
   * Removes a registry.
   *
   * @param name - The registry to remove. Throws a 404 when there is none by that name.
   */
  async removeRegistry(name: string): Promise<void> {
    if (!this.getRegistry(name)) {
      throw notFound(`Unknown registry "${name}"`);
    }
    await this.db.delete(registries).where(eq(registries.name, name));
    await this.reload();
  }

  /**
   * Creates or replaces a server config. Replacing keeps the server's workspace memberships.
   *
   * @param config - The config; its `name` is the key.
   * @returns The config as stored. Throws when it fails validation.
   */
  async saveServer(config: ServerConfig): Promise<ServerConfig> {
    const parsed = serverConfigSchema.parse(config);
    await this.db.transaction((tx) => upsertServer(tx, parsed));
    await this.reload();
    return this.servers.get(parsed.name) ?? parsed;
  }

  /**
   * Removes a server config, and with it the server's place in every workspace.
   *
   * @param name - The server's name; an unknown one is not an error.
   */
  async deleteServer(name: string): Promise<void> {
    await this.db.delete(servers).where(eq(servers.name, name));
    await this.reload();
  }

  /**
   * Lists the workspace configs.
   *
   * @returns A new array, sorted by name.
   */
  getWorkspaces(): WorkspaceConfig[] {
    return [...this.workspaces.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Finds a workspace config.
   *
   * @param slug - The workspace's slug.
   * @returns The config, or undefined when there is none by that slug.
   */
  getWorkspace(slug: string): WorkspaceConfig | undefined {
    return this.workspaces.get(slug);
  }

  /**
   * Creates or replaces a workspace config with exactly the members it names.
   *
   * @param config - The config; its `slug` is the key. A member naming no existing server is not stored (logged).
   * @returns The config as stored. Throws when it fails validation.
   */
  async saveWorkspace(config: WorkspaceConfig): Promise<WorkspaceConfig> {
    const parsed = workspaceConfigSchema.parse(config);
    await this.db.transaction((tx) => upsertWorkspace(tx, parsed));
    await this.reload();
    return this.workspaces.get(parsed.slug) ?? parsed;
  }

  /**
   * Removes a workspace config and its memberships.
   *
   * @param slug - The workspace's slug; an unknown one is not an error.
   */
  async deleteWorkspace(slug: string): Promise<void> {
    await this.db.delete(workspaces).where(eq(workspaces.slug, slug));
    await this.reload();
  }

  /**
   * Reads the one settings row.
   *
   * @returns The row, or undefined when there is none yet.
   */
  private async readSettingsRow(): Promise<SettingsRow | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID));
    return row;
  }

  /**
   * Stores settings in the one settings row, creating it when it is missing.
   *
   * @param value - Validated settings.
   */
  private async writeSettings(value: SettingsFile): Promise<void> {
    const values = settingsToRow(value);
    await this.db
      .insert(settings)
      .values({ id: SETTINGS_ROW_ID, ...values })
      .onConflictDoUpdate({ target: settings.id, set: { ...values, updatedAt: new Date() } });
  }

  /** Replaces everything in memory with what the database holds. */
  private async loadAll(): Promise<void> {
    this.settings = await this.loadSettings();
    this.registries = await this.loadRegistries();
    this.servers = await this.loadServers();
    this.workspaces = await this.loadWorkspaces();
  }

  /**
   * Reads the settings row, storing it when a bearer token or the instance id had to be filled in.
   *
   * @returns The settings. Throws when the row fails validation.
   *
   * @remarks
   * A token is generated, and printed that one time, when auth is on and neither the row nor `MCP_ROUTER_TOKEN`
   * holds one.
   */
  private async loadSettings(): Promise<SettingsFile> {
    const row = await this.readSettingsRow();
    let loaded: SettingsFile;
    try {
      loaded = row === undefined ? settingsFileSchema.parse({}) : settingsFromRow(row);
    } catch (cause) {
      throw new Error(`The settings row failed validation: ${errorMessage(cause)}`, { cause });
    }
    const next = { ...loaded };
    const auth = effectiveAuth(next);
    // Auth is on and neither the settings nor MCP_ROUTER_TOKEN holds a token.
    if (auth.enabled && !auth.token) {
      next.authToken = randomBytes(CONFIG_DEFAULTS.authTokenBytes).toString('hex');
      // The one time the token is printed: first run, when nobody has seen it yet.
      console.log(`[auth] generated a bearer token and saved it in the settings table:\n  ${next.authToken}`);
    }
    // Kept once written, so renaming the machine does not change the router's identity on the network.
    if (next.instanceId === undefined) {
      next.instanceId = hostSlug(hostname(), FALLBACK_INSTANCE_ID);
    }
    const isChanged = row === undefined || next.authToken !== loaded.authToken || next.instanceId !== loaded.instanceId;
    if (isChanged) {
      await this.writeSettings(next);
    }
    return next;
  }

  /**
   * Reads the registries.
   *
   * @returns The registries, oldest first. Throws when a row fails validation.
   */
  private async loadRegistries(): Promise<Registry[]> {
    const rows = await this.db.select().from(registries).orderBy(asc(registries.createdAt), asc(registries.name));
    return rows.map(registryFromRow);
  }

  /**
   * Reads every server, logging and skipping a row that fails validation.
   *
   * @returns The configs by name.
   */
  private async loadServers(): Promise<Map<string, ServerConfig>> {
    const loaded = new Map<string, ServerConfig>();
    for (const row of await this.db.select().from(servers)) {
      try {
        loaded.set(row.name, serverFromRow(row));
      } catch (error) {
        // One bad row must not take the router down; report and skip it.
        console.error(`[db] ignoring invalid server "${row.name}": ${errorMessage(error)}`);
      }
    }
    return loaded;
  }

  /**
   * Reads every workspace with its members, logging and skipping one that fails validation.
   *
   * @returns The configs by slug.
   */
  private async loadWorkspaces(): Promise<Map<string, WorkspaceConfig>> {
    const memberRows = await this.db
      .select({ serverName: servers.name, member: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(servers, eq(workspaceMembers.serverId, servers.id))
      .orderBy(asc(servers.name));
    const membersByWorkspace = new Map<string, NamedMemberRow[]>();
    for (const row of memberRows) {
      const members = membersByWorkspace.get(row.member.workspaceId) ?? [];
      membersByWorkspace.set(row.member.workspaceId, [...members, row]);
    }
    const loaded = new Map<string, WorkspaceConfig>();
    for (const row of await this.db.select().from(workspaces)) {
      try {
        loaded.set(row.slug, workspaceFromRows(row, membersByWorkspace.get(row.id) ?? []));
      } catch (error) {
        // One bad row must not take the router down; report and skip it.
        console.error(`[db] ignoring invalid workspace "${row.slug}": ${errorMessage(error)}`);
      }
    }
    return loaded;
  }
}
