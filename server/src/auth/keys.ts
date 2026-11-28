import { defaultKeyHasher } from '@better-auth/api-key';
import { SECONDS_PER_DAY } from '@mcp-router/shared';
import { desc, eq } from 'drizzle-orm';
import { CALLER_AGENT } from '../core/context.ts';
import { notFound } from '../core/errors.ts';
import { isRecord } from '../core/is-record.ts';
import type { DB } from '../db/client.ts';
import { type ApiKeyRow, apikeys } from '../db/tables/apikeys.ts';
import type { Auth } from './better-auth.ts';

// API keys for machine callers: agents, MCP clients, scripts. better-auth's api-key plugin mints and checks them and
// stores only their hash. Keys are made only from a session (permissions.ts), so a leaked key can't mint its
// successor. Listing and revoking are plain reads and deletes on the table; deleting the row is the revocation.

/** Who owns a key carried over from the old router token: no account, the router itself. */
export const IMPORTED_KEY_OWNER = 'router';

/** Where an imported key came from. */
export const ImportedFrom = {
  /** `auth_token` in the settings table: the token the router generated, or a config file's. */
  Settings: 'settings',
  /** The `MCP_ROUTER_TOKEN` environment variable. */
  Env: 'env',
} as const;
/** One of the values in {@link ImportedFrom}. */
export type ImportedFrom = (typeof ImportedFrom)[keyof typeof ImportedFrom];

/** What each imported key is called in the list. */
const IMPORTED_NAMES: Readonly<Record<ImportedFrom, string>> = {
  [ImportedFrom.Settings]: 'Imported router token',
  [ImportedFrom.Env]: 'MCP_ROUTER_TOKEN',
};

/** How many characters of an imported token are kept in the clear, as the plugin keeps of a minted key. */
const VISIBLE_CHARS = 6;

/** An API key as the operator sees it. Never the key itself, which exists only in the answer to `createApiKey`. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** The key's first characters, to tell keys apart. */
  start: string | null;
  createdAt: Date;
  /** Null for a key that never expires. */
  expiresAt: Date | null;
  /** When the key last authenticated a request. */
  lastUsedAt: Date | null;
  /** Where a key carried over from the old router token came from, or null for one made in the UI. */
  importedFrom: ImportedFrom | null;
}

/** A key just made: the only time its plaintext exists. */
export interface CreatedApiKey {
  /** The whole key, for the caller to send as `x-api-key` or `Authorization: Bearer`. Never stored or logged. */
  key: string;
  apiKey: ApiKeySummary;
}

/**
 * Reads where an imported key came from, out of its metadata.
 *
 * @param metadata - The column as stored. Some plugin versions double-encode it, so it is parsed defensively.
 * @returns The source, or null for a key made in the UI and for metadata that does not parse.
 */
function importedFrom(metadata: string | null): ImportedFrom | null {
  let parsed: unknown = metadata;
  // At most twice: once for the column, once more for a double-encoded value.
  for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  const source = isRecord(parsed) ? parsed.imported : undefined;
  return source === ImportedFrom.Settings || source === ImportedFrom.Env ? source : null;
}

/**
 * Describes a key row for the operator.
 *
 * @param row - The row.
 * @returns What the UI lists.
 */
function summarize(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name ?? '',
    start: row.start,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastRequest,
    importedFrom: importedFrom(row.metadata),
  };
}

/** What a new key is made with. */
export interface NewKey {
  /** The person making it. */
  userId: string;
  /** What to call it. */
  name: string;
  /** Days until it stops working; null never. */
  expiresInDays: number | null;
}

/**
 * Mints a key.
 *
 * @param db - The database, to read the stored row back.
 * @param auth - The auth instance, whose api-key plugin mints it.
 * @param input - Who makes it, its name and its lifetime.
 * @returns The key, once, and what is stored about it.
 *
 * @remarks
 * Minted server-side, with no headers, so the server-only fields (the owner, the rate limit) can be set.
 */
export async function createKey(db: DB, auth: Auth, { userId, name, expiresInDays }: NewKey): Promise<CreatedApiKey> {
  const created = await auth.api.createApiKey({
    body: {
      userId,
      name,
      metadata: { kind: CALLER_AGENT },
      rateLimitEnabled: false,
      expiresIn: expiresInDays === null ? null : expiresInDays * SECONDS_PER_DAY,
    },
  });
  const [row] = await db.select().from(apikeys).where(eq(apikeys.id, created.id));
  if (row === undefined) {
    throw new Error(`The API key "${name}" was minted but its row is missing.`);
  }
  return { key: created.key, apiKey: summarize(row) };
}

/**
 * Lists every key, newest first.
 *
 * @param db - The database.
 * @returns What the operator sees of each.
 */
export async function listKeys(db: DB): Promise<ApiKeySummary[]> {
  const rows = await db.select().from(apikeys).orderBy(desc(apikeys.createdAt));
  return rows.map(summarize);
}

/**
 * Revokes a key: deletes its row, so it stops working on its next request.
 *
 * @param db - The database.
 * @param id - The key.
 * @throws NOT_FOUND when there is no such key.
 */
export async function revokeKey(db: DB, id: string): Promise<void> {
  const deleted = await db.delete(apikeys).where(eq(apikeys.id, id)).returning({ id: apikeys.id });
  if (deleted.length === 0) {
    throw notFound(`No API key with id "${id}".`);
  }
}

/**
 * Carries the old router token over as an API key with that exact value, so MCP clients configured with it keep
 * working.
 *
 * @param db - The database.
 * @param token - The token as it was configured.
 * @param from - Where it was configured.
 * @returns True when a key was made, false when one with that value already exists.
 *
 * @remarks
 * Written straight to the table, hashed the way the plugin hashes, because the plugin only mints keys of its own. Owned
 * by {@link IMPORTED_KEY_OWNER}, not a person, so importing makes no account and a new router can still be paired
 * from its login page. Idempotent: the hash is unique.
 */
export async function importToken(db: DB, token: string, from: ImportedFrom): Promise<boolean> {
  const hash = await defaultKeyHasher(token);
  const inserted = await db
    .insert(apikeys)
    .values({
      name: IMPORTED_NAMES[from],
      start: token.slice(0, VISIBLE_CHARS),
      prefix: null,
      key: hash,
      referenceId: IMPORTED_KEY_OWNER,
      rateLimitEnabled: false,
      metadata: JSON.stringify({ kind: CALLER_AGENT, imported: from }),
    })
    .onConflictDoNothing({ target: apikeys.key })
    .returning({ id: apikeys.id });
  return inserted.length > 0;
}
