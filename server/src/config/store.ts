import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_REGISTRY,
  type RegistriesFile,
  type Registry,
  registriesFileSchema,
  type ServerConfig,
  type SettingsFile,
  serverConfigSchema,
  settingsFileSchema,
  type WorkspaceConfig,
  workspaceConfigSchema,
} from '@mcp-router/shared';
import { type FSWatcher, watch } from 'chokidar';
import { effectiveAuth } from '../auth/middleware.ts';
import { CONFIG_DEFAULTS } from '../core/defaults.ts';
import { conflict, errorMessage, notFound } from '../core/errors.ts';

/** Owner read and write only: these files hold the auth token and API keys in plain text. */
const CONFIG_FILE_MODE = 0o600;

/** Everything the config files hold, as last loaded. */
export interface ConfigState {
  settings: SettingsFile;
  registries: Registry[];
  servers: ServerConfig[];
  workspaces: WorkspaceConfig[];
}

/**
 * Owns the flat config files under DATA_DIR/config: settings.json, registries.json, servers/<name>.json and
 * workspaces/<slug>.json.
 *
 * @remarks
 * All writes are atomic (tmp file + chmod 0600 + rename). Emits a typed 'change' event, debounced, when the files
 * change on disk while it is watching.
 */
export class ConfigStore extends EventEmitter<{ change: [ConfigState] }> {
  readonly dataDir: string;
  /** `<dataDir>/config`. */
  readonly configDir: string;
  /** `<configDir>/servers`, one file per server. */
  readonly serversDir: string;
  /** `<configDir>/workspaces`, one file per workspace. */
  readonly workspacesDir: string;

  private settings: SettingsFile = settingsFileSchema.parse({});
  private registries: Registry[] = [];
  private servers = new Map<string, ServerConfig>();
  private workspaces = new Map<string, WorkspaceConfig>();
  private watcher: FSWatcher | null = null;
  private watchDebounce: NodeJS.Timeout | null = null;

  /**
   * Works out the config paths; nothing is read or created until `init`.
   *
   * @param dataDir - The data directory; config lives in its `config` folder.
   */
  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.configDir = path.join(dataDir, 'config');
    this.serversDir = path.join(this.configDir, 'servers');
    this.workspacesDir = path.join(this.configDir, 'workspaces');
  }

  /** Create directories, seed defaults on first run and load everything. */
  async init(): Promise<void> {
    await mkdir(this.serversDir, { recursive: true });
    await mkdir(this.workspacesDir, { recursive: true });
    await this.loadAll();
  }

  /**
   * Re-read every config file from disk.
   *
   * @returns The new state. Rejects when settings.json or registries.json is invalid; a bad server or workspace
   * file is logged and skipped.
   */
  async reload(): Promise<ConfigState> {
    await this.loadAll();
    return this.snapshot();
  }

  /** Start watching the config dir; emits 'change' (debounced) after reloading. A no-op when already watching. */
  startWatching(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = watch(this.configDir, { ignoreInitial: true, depth: 2 });
    this.watcher.on('all', () => {
      if (this.watchDebounce) {
        clearTimeout(this.watchDebounce);
      }
      this.watchDebounce = setTimeout(() => {
        this.watchDebounce = null;
        this.reload()
          .then((state) => this.emit('change', state))
          .catch((err: unknown) => {
            console.error(`[config] reload after a file change failed: ${errorMessage(err)}`);
          });
      }, CONFIG_DEFAULTS.watchDebounceMs);
    });
  }

  /** Stop watching the config dir and drop any reload still waiting on the debounce. */
  async close(): Promise<void> {
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
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
   * @returns The registries in file order.
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
   * Merge a partial settings update, persist settings.json, and apply it in memory.
   *
   * @param patch - The fields to change; the rest keep their values.
   * @returns The merged settings. Throws, changing nothing, when the result fails validation.
   */
  async updateSettings(patch: Partial<SettingsFile>): Promise<SettingsFile> {
    const next = settingsFileSchema.parse({ ...this.settings, ...patch });
    await this.writeJsonAtomic(path.join(this.configDir, 'settings.json'), next);
    this.settings = next;
    return next;
  }

  /**
   * Adds a registry and persists registries.json.
   *
   * @param registry - The registry to add. Throws a 409 when its name is taken.
   */
  async addRegistry(registry: Registry): Promise<void> {
    if (this.getRegistry(registry.name)) {
      throw conflict(`Registry "${registry.name}" already exists`);
    }
    this.registries = [...this.registries, registry];
    await this.writeRegistries();
  }

  /**
   * Removes a registry and persists registries.json.
   *
   * @param name - The registry to remove. Throws a 404 when there is none by that name.
   */
  async removeRegistry(name: string): Promise<void> {
    if (!this.getRegistry(name)) {
      throw notFound(`Unknown registry "${name}"`);
    }
    this.registries = this.registries.filter((r) => r.name !== name);
    await this.writeRegistries();
  }

  /**
   * Creates or replaces a server config, in memory and in its file.
   *
   * @param config - The config; its `name` is the key and the file name.
   * @returns The config as validated. Throws when it fails validation.
   */
  async saveServer(config: ServerConfig): Promise<ServerConfig> {
    const parsed = serverConfigSchema.parse(config);
    this.servers.set(parsed.name, parsed);
    await this.writeJsonAtomic(this.serverFile(parsed.name), parsed);
    return parsed;
  }

  /**
   * Removes a server config, from memory and from disk.
   *
   * @param name - The server's name; an unknown one is not an error.
   */
  async deleteServer(name: string): Promise<void> {
    this.servers.delete(name);
    await rm(this.serverFile(name), { force: true });
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
   * Creates or replaces a workspace config, in memory and in its file.
   *
   * @param config - The config; its `slug` is the key and the file name.
   * @returns The config as validated. Throws when it fails validation.
   */
  async saveWorkspace(config: WorkspaceConfig): Promise<WorkspaceConfig> {
    const parsed = workspaceConfigSchema.parse(config);
    this.workspaces.set(parsed.slug, parsed);
    await this.writeJsonAtomic(this.workspaceFile(parsed.slug), parsed);
    return parsed;
  }

  /**
   * Removes a workspace config, from memory and from disk.
   *
   * @param slug - The workspace's slug; an unknown one is not an error.
   */
  async deleteWorkspace(slug: string): Promise<void> {
    this.workspaces.delete(slug);
    await rm(this.workspaceFile(slug), { force: true });
  }

  /** Persists the in-memory registries to registries.json. */
  private async writeRegistries(): Promise<void> {
    const file: RegistriesFile = { registries: this.registries };
    await this.writeJsonAtomic(path.join(this.configDir, 'registries.json'), file);
  }

  /**
   * Names the file a server's config is kept in.
   *
   * @param name - The server's name.
   * @returns The path of `servers/<name>.json`.
   */
  private serverFile(name: string): string {
    return path.join(this.serversDir, `${name}.json`);
  }

  /**
   * Names the file a workspace's config is kept in.
   *
   * @param slug - The workspace's slug.
   * @returns The path of `workspaces/<slug>.json`.
   */
  private workspaceFile(slug: string): string {
    return path.join(this.workspacesDir, `${slug}.json`);
  }

  /** Replaces everything in memory with what the files hold, seeding settings.json and registries.json when absent. */
  private async loadAll(): Promise<void> {
    this.settings = await this.loadSettings();
    this.registries = await this.loadRegistries();
    this.servers = await this.loadServers();
    this.workspaces = await this.loadWorkspaces();
  }

  /**
   * Reads settings.json, writing it when it is absent or a bearer token had to be generated.
   *
   * @returns The settings. Throws when the file is not valid JSON or fails validation.
   *
   * @remarks
   * A token is generated, and printed that one time, when auth is on and neither the file nor `MCP_ROUTER_TOKEN`
   * holds one.
   */
  private async loadSettings(): Promise<SettingsFile> {
    const file = path.join(this.configDir, 'settings.json');
    let settings: SettingsFile;
    let dirty = false;
    if (existsSync(file)) {
      settings = this.parseFile(file, await readFile(file, 'utf8'), settingsFileSchema.parse.bind(settingsFileSchema));
    } else {
      settings = settingsFileSchema.parse({});
      dirty = true;
    }
    const auth = effectiveAuth(settings);
    // Auth is on and neither settings.json nor MCP_ROUTER_TOKEN holds a token.
    if (auth.enabled && !auth.token) {
      settings.authToken = randomBytes(CONFIG_DEFAULTS.authTokenBytes).toString('hex');
      dirty = true;
      // The one time the token is printed: first run, when nobody has seen it yet.
      console.log(`[auth] generated a bearer token and saved it to ${file}:\n  ${settings.authToken}`);
    }
    if (dirty) {
      await this.writeJsonAtomic(file, settings);
    }
    return settings;
  }

  /**
   * Reads registries.json, seeding it with the default registry when it is absent.
   *
   * @returns The registries. Throws when the file is not valid JSON or fails validation.
   */
  private async loadRegistries(): Promise<Registry[]> {
    const file = path.join(this.configDir, 'registries.json');
    if (!existsSync(file)) {
      const seeded: RegistriesFile = { registries: [DEFAULT_REGISTRY] };
      await this.writeJsonAtomic(file, seeded);
      return seeded.registries;
    }
    const parsed = this.parseFile(
      file,
      await readFile(file, 'utf8'),
      registriesFileSchema.parse.bind(registriesFileSchema),
    );
    return parsed.registries;
  }

  /**
   * Reads every `servers/*.json`, logging and skipping a file that is invalid.
   *
   * @returns The configs by the `name` inside each file, which wins over a file name that disagrees.
   */
  private async loadServers(): Promise<Map<string, ServerConfig>> {
    const servers = new Map<string, ServerConfig>();
    const files = (await readdir(this.serversDir)).filter((f) => f.endsWith('.json'));
    for (const file of files.sort()) {
      const fullPath = path.join(this.serversDir, file);
      try {
        const config = this.parseFile(
          fullPath,
          await readFile(fullPath, 'utf8'),
          serverConfigSchema.parse.bind(serverConfigSchema),
        );
        if (`${config.name}.json` !== file) {
          console.warn(`[config] server config ${fullPath} has name "${config.name}" that does not match its filename`);
        }
        servers.set(config.name, config);
      } catch (err) {
        // A single broken (hand-edited) server file must not take the router down; report and skip it.
        console.error(`[config] ignoring invalid server config ${fullPath}: ${errorMessage(err)}`);
      }
    }
    return servers;
  }

  /**
   * Reads every `workspaces/*.json`, logging and skipping a file that is invalid.
   *
   * @returns The configs by the `slug` inside each file, which wins over a file name that disagrees.
   */
  private async loadWorkspaces(): Promise<Map<string, WorkspaceConfig>> {
    const workspaces = new Map<string, WorkspaceConfig>();
    const files = (await readdir(this.workspacesDir)).filter((f) => f.endsWith('.json'));
    for (const file of files.sort()) {
      const fullPath = path.join(this.workspacesDir, file);
      try {
        const config = this.parseFile(
          fullPath,
          await readFile(fullPath, 'utf8'),
          workspaceConfigSchema.parse.bind(workspaceConfigSchema),
        );
        if (`${config.slug}.json` !== file) {
          console.warn(
            `[config] workspace config ${fullPath} has slug "${config.slug}" that does not match its filename`,
          );
        }
        workspaces.set(config.slug, config);
      } catch (err) {
        // A single broken (hand-edited) workspace file must not take the router down; report and skip it.
        console.error(`[config] ignoring invalid workspace config ${fullPath}: ${errorMessage(err)}`);
      }
    }
    return workspaces;
  }

  /**
   * Parses and validates one config file's text.
   *
   * @typeParam T - The validated shape.
   * @param file - The file's path, named in the error.
   * @param raw - The file's text.
   * @param parse - Validates the parsed JSON; throws to reject it.
   * @returns The validated value. Throws an Error naming the file when the JSON or the validation fails.
   */
  private parseFile<T>(file: string, raw: string, parse: (value: unknown) => T): T {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new Error(`${file} is not valid JSON: ${errorMessage(cause)}`, { cause });
    }
    try {
      return parse(json);
    } catch (cause) {
      throw new Error(`${file} failed validation: ${errorMessage(cause)}`, { cause });
    }
  }

  /**
   * Writes a value as JSON atomically: tmp file in the same dir, chmod 0600, rename over the target.
   *
   * @param file - The target path.
   * @param value - What to serialise, with two-space indent and a trailing newline.
   */
  private async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: CONFIG_FILE_MODE });
    await chmod(tmp, CONFIG_FILE_MODE);
    await rename(tmp, file);
  }
}
