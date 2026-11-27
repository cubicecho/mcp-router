import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres';
import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { claimPidLock } from './lock.ts';
import { relations } from './relations.ts';

/**
 * The committed migrations, in the server package's `drizzle/` folder. This module is `src/db/` in dev and `dist/db/`
 * in production, so two levels up is the package root either way.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The PGlite store a memory database uses: nothing on disk, gone when it closes. */
export const MEMORY_STORE = 'memory://';

/** The Drizzle client, on node-postgres or PGlite: both run the same SQL. */
export type DB = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;
/** The transaction a multi-row write runs in. */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];

/** The router's database, and what boot and shutdown do with it. */
export interface Database {
  db: DB;
  /** Whether it is a Postgres server, which boot waits for. PGlite is up once it is constructed. */
  isPostgres: boolean;
  /** Where it is, for the boot log, with no password in it. */
  location: string;
  /** Applies the committed migrations. */
  ensureSchema: () => Promise<void>;
  /** Closes it after the server has drained. For a PGlite data dir this flushes it and removes the lockfile. */
  close: () => Promise<void>;
}

/**
 * Whether a database URL names a Postgres server rather than a PGlite store.
 *
 * @param url - The `DATABASE_URL` value.
 * @returns True for a postgres:// or postgresql:// URL.
 */
export function usesPostgres(url: string): boolean {
  return /^postgres(ql)?:\/\//.test(url);
}

/**
 * Opens node-postgres against a server. Nothing connects until the first query.
 *
 * @param connectionString - A postgres:// URL.
 * @returns The database.
 */
function openPostgres(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  const db = drizzleNode({ client: pool, relations });
  const url = new URL(connectionString);
  return {
    db,
    isPostgres: true,
    location: `postgres ${url.hostname}${url.pathname}`,
    ensureSchema: async () => {
      await migrateNode(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => pool.end(),
  };
}

/**
 * Opens PGlite in this process. A data dir is created when missing and claimed with a pid lockfile beside it.
 *
 * @param store - A data directory, or {@link MEMORY_STORE}.
 * @returns The database.
 * @throws When another running process holds the data dir.
 */
function openPglite(store: string): Database {
  const isDirectory = store.includes('://') === false;
  let release = () => {};
  if (isDirectory) {
    mkdirSync(store, { recursive: true });
    release = claimPidLock(`${store}.lock`, store).release;
  }
  const client = new PGlite(store);
  const db = drizzlePglite({ client, relations });
  return {
    db,
    isPostgres: false,
    location: `PGlite ${store}`,
    ensureSchema: async () => {
      await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: async () => {
      await client.close();
      // After the close, so only a killed process leaves the lock behind.
      release();
    },
  };
}

/**
 * Opens the router's database: Postgres for a postgres:// URL, PGlite otherwise.
 *
 * @param url - `DATABASE_URL`. Empty uses the PGlite data dir `<dataDir>/pg`; anything else that is not a postgres://
 * URL is where PGlite keeps its data (`memory://` in tests).
 * @param dataDir - The data directory.
 * @returns The database, not yet migrated.
 */
export function openDatabase(url: string, dataDir: string): Database {
  if (usesPostgres(url)) {
    return openPostgres(url);
  }
  return openPglite(url === '' ? path.join(dataDir, 'pg') : url);
}
