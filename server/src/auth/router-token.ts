import { envToken } from '../config/env.ts';
import type { ConfigStore } from '../config/store.ts';
import type { DB } from '../db/client.ts';
import { ImportedFrom, importToken } from './keys.ts';

// Before API keys, the router had one bearer token: generated into the settings table on first boot, or set as
// MCP_ROUTER_TOKEN. MCP clients configured with it must keep working, so boot carries it over as an API key with
// that exact value, then clears the stored copy. MCP_ROUTER_TOKEN stays a way to configure a key from the deployment.

/** What carrying the old token over did. */
export interface CarriedTokens {
  /** Where each token that became a new key came from. */
  imported: ImportedFrom[];
  /** Whether `authEnabled` was false in the settings, which no longer turns auth off. */
  wasAuthDisabled: boolean;
}

/**
 * Imports the stored router token and `MCP_ROUTER_TOKEN` as API keys, then clears the stored token.
 *
 * @param db - The database the keys go in.
 * @param store - The config, whose settings hold the stored token.
 * @param [env] - The process environment, for `MCP_ROUTER_TOKEN`.
 * @returns What was imported. A token already imported is not imported again, so this runs on every boot.
 *
 * @remarks
 * The stored token is cleared only after its key is written, so a failed boot imports it next time. A revoked
 * MCP_ROUTER_TOKEN key comes back at the next boot while the variable is still set: unset it first.
 */
export async function carryOverRouterTokens(
  db: DB,
  store: ConfigStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CarriedTokens> {
  const settings = store.getSettings();
  const imported: ImportedFrom[] = [];
  const stored = settings.authToken?.trim() ?? '';
  if (stored !== '') {
    if (await importToken(db, stored, ImportedFrom.Settings)) {
      imported.push(ImportedFrom.Settings);
    }
    await store.updateSettings({ authToken: null });
  }
  const fromEnv = envToken(env);
  if (fromEnv !== undefined && (await importToken(db, fromEnv, ImportedFrom.Env))) {
    imported.push(ImportedFrom.Env);
  }
  return { imported, wasAuthDisabled: settings.authEnabled === false };
}
