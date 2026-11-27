// First boot on an empty database: the config files an older router kept under DATA_DIR/config move into the tables.
import { existsSync } from 'node:fs';
import { readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_REGISTRY,
  type Registry,
  registriesFileSchema,
  registrySchema,
  type ServerConfig,
  type SettingsFile,
  serverConfigSchema,
  settingsFileSchema,
  type WorkspaceConfig,
  workspaceConfigSchema,
  workspaceMemberSchema,
} from '@mcp-router/shared';
import { errorMessage } from '../core/errors.ts';
import type { DB } from '../db/client.ts';
import { registries } from '../db/tables/registries.ts';
import { settings } from '../db/tables/settings.ts';
import { registryToRow, settingsToRow } from './rows.ts';
import { upsertServer, upsertWorkspace } from './writes.ts';

/** What an imported file is renamed to, so it is kept but never read again. */
export const IMPORTED_SUFFIX = '.imported';

/** One config file read and validated. */
interface FoundFile<T> {
  file: string;
  value: T;
  /** Whether it held keys the tables have no column for, which are dropped. */
  hasUnknownKeys: boolean;
}

/** Everything read from a config dir. */
interface ConfigFiles {
  settings: FoundFile<SettingsFile> | undefined;
  registries: FoundFile<Registry[]> | undefined;
  servers: FoundFile<ServerConfig>[];
  workspaces: FoundFile<WorkspaceConfig>[];
}

/** What the import moved into the database. */
export interface ImportSummary {
  /** The files imported, each now renamed with {@link IMPORTED_SUFFIX}. */
  files: string[];
  registries: number;
  servers: number;
  workspaces: number;
}

/**
 * Whether a parsed value has keys outside a list.
 *
 * @param value - Parsed JSON.
 * @param known - The keys a schema names.
 * @returns True when it is an object with a key not in `known`.
 */
function hasKeysBeyond(value: unknown, known: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.keys(value).some((key) => known.includes(key) === false);
}

/**
 * Lists the top-level members of a record that are objects.
 *
 * @param value - Parsed JSON that should be a record of objects.
 * @returns Its values, or none when it is not an object.
 */
function recordValues(value: unknown): unknown[] {
  return typeof value === 'object' && value !== null ? Object.values(value) : [];
}

/**
 * Reads and validates one config file.
 *
 * @typeParam T - The validated shape.
 * @param file - The file's path, named in the error.
 * @param parse - Validates the parsed JSON, and says whether it held unknown keys; throws to reject it.
 * @returns The file. Throws an Error naming the file when the JSON or the validation fails.
 */
async function readConfigFile<T>(
  file: string,
  parse: (json: unknown) => { value: T; hasUnknownKeys: boolean },
): Promise<FoundFile<T>> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    throw new Error(`${file} is not valid JSON: ${errorMessage(cause)}`, { cause });
  }
  try {
    return { file, ...parse(json) };
  } catch (cause) {
    throw new Error(`${file} failed validation: ${errorMessage(cause)}`, { cause });
  }
}

/**
 * Reads every `*.json` in a folder, logging and skipping a file that is invalid, as the file-backed store did.
 *
 * @typeParam T - The validated shape.
 * @param dir - The folder; a missing one holds nothing.
 * @param parse - Validates one file's JSON.
 * @returns The valid files, by file name.
 */
async function readConfigFolder<T>(
  dir: string,
  parse: (json: unknown) => { value: T; hasUnknownKeys: boolean },
): Promise<FoundFile<T>[]> {
  if (existsSync(dir) === false) {
    return [];
  }
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const read: FoundFile<T>[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      read.push(await readConfigFile(file, parse));
    } catch (error) {
      // Left in place, not renamed, so it can be fixed and added again by hand.
      console.error(`[db] not importing ${file}: ${errorMessage(error)}`);
    }
  }
  return read;
}

const SETTINGS_KEYS = Object.keys(settingsFileSchema.shape);
const REGISTRIES_FILE_KEYS = Object.keys(registriesFileSchema.shape);
const REGISTRY_KEYS = Object.keys(registrySchema.shape);
const SERVER_KEYS = Object.keys(serverConfigSchema.shape);
const WORKSPACE_KEYS = Object.keys(workspaceConfigSchema.shape);
const MEMBER_KEYS = Object.keys(workspaceMemberSchema.shape);

/**
 * Reads every config file under a config dir.
 *
 * @param configDir - `DATA_DIR/config`.
 * @returns What was found. Throws when settings.json or registries.json is invalid.
 */
async function readConfigDir(configDir: string): Promise<ConfigFiles> {
  const settingsFile = path.join(configDir, 'settings.json');
  const registriesFile = path.join(configDir, 'registries.json');
  return {
    settings: existsSync(settingsFile)
      ? await readConfigFile(settingsFile, (json) => ({
          value: settingsFileSchema.parse(json),
          hasUnknownKeys: hasKeysBeyond(json, SETTINGS_KEYS),
        }))
      : undefined,
    registries: existsSync(registriesFile)
      ? await readConfigFile(registriesFile, (json) => {
          const items = typeof json === 'object' && json !== null && 'registries' in json ? json.registries : [];
          return {
            value: registriesFileSchema.parse(json).registries,
            hasUnknownKeys:
              hasKeysBeyond(json, REGISTRIES_FILE_KEYS) ||
              recordValues(items).some((item) => hasKeysBeyond(item, REGISTRY_KEYS)),
          };
        })
      : undefined,
    servers: await readConfigFolder(path.join(configDir, 'servers'), (json) => ({
      value: serverConfigSchema.parse(json),
      hasUnknownKeys: hasKeysBeyond(json, SERVER_KEYS),
    })),
    workspaces: await readConfigFolder(path.join(configDir, 'workspaces'), (json) => {
      const members = typeof json === 'object' && json !== null && 'members' in json ? json.members : {};
      return {
        value: workspaceConfigSchema.parse(json),
        hasUnknownKeys:
          hasKeysBeyond(json, WORKSPACE_KEYS) ||
          recordValues(members).some((member) => hasKeysBeyond(member, MEMBER_KEYS)),
      };
    }),
  };
}

/**
 * Fills an empty database: imports the config files under `configDir` in one transaction, then renames each imported
 * file to `<file>.imported`. What the files leave out is seeded: the settings row with its defaults, and the
 * `official` registry when there was no registries.json.
 *
 * @param db - A migrated database with no settings row.
 * @param configDir - `DATA_DIR/config`; missing is the same as empty.
 * @returns What was imported. Throws, storing nothing, when settings.json or registries.json is invalid.
 */
export async function seedDatabase(db: DB, configDir: string): Promise<ImportSummary> {
  const found = await readConfigDir(configDir);
  const importedRegistries = found.registries?.value ?? [];
  await db.transaction(async (tx) => {
    const seededSettings = found.settings?.value ?? settingsFileSchema.parse({});
    await tx.insert(settings).values(settingsToRow(seededSettings));
    const seededRegistries = found.registries === undefined ? [DEFAULT_REGISTRY] : importedRegistries;
    // One transaction shares one now(), so each registry gets its own time to keep the file's order.
    const start = Date.now();
    const registryRows = seededRegistries.map((registry, index) => ({
      ...registryToRow(registry),
      createdAt: new Date(start + index),
    }));
    if (registryRows.length > 0) {
      await tx.insert(registries).values(registryRows);
    }
    for (const server of found.servers) {
      await upsertServer(tx, server.value);
    }
    // After the servers, which the memberships point at.
    for (const workspace of found.workspaces) {
      await upsertWorkspace(tx, workspace.value);
    }
  });

  const imported = [found.settings, found.registries, ...found.servers, ...found.workspaces].flatMap((read) =>
    read === undefined ? [] : [read],
  );
  for (const { file } of imported) {
    try {
      await rename(file, `${file}${IMPORTED_SUFFIX}`);
    } catch (error) {
      // The rows are committed, and a database with a settings row is never imported into again.
      console.warn(`[db] imported ${file} but could not rename it: ${errorMessage(error)}`);
    }
  }
  const summary: ImportSummary = {
    files: imported.map(({ file }) => file),
    registries: importedRegistries.length,
    servers: found.servers.length,
    workspaces: found.workspaces.length,
  };
  if (imported.length > 0) {
    const parts = [
      found.settings === undefined ? 'no settings' : 'settings',
      `${summary.registries} registries`,
      `${summary.servers} servers`,
      `${summary.workspaces} workspaces`,
    ];
    console.log(`[db] imported ${parts.join(', ')} from ${configDir}; the files are renamed *${IMPORTED_SUFFIX}`);
  }
  const withUnknownKeys = imported.filter((read) => read.hasUnknownKeys).map(({ file }) => file);
  if (withUnknownKeys.length > 0) {
    console.warn(`[db] keys with no column were dropped from: ${withUnknownKeys.join(', ')}`);
  }
  return summary;
}
