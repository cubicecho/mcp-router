import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { relations } from './relations.ts';
import { requiresSsl } from './ssl.ts';

/**
 * The committed migrations, in the server package's `drizzle/` folder, two levels up from this module's `src/db/`.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The Drizzle client. node-postgres in the router; tests pass PGlite, which runs the same SQL. */
export type DB = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;
/** The transaction a multi-row write runs in. */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];

/** The router's database, and what boot and shutdown do with it. */
export interface Database {
  db: DB;
  /** Where it is, for the boot log, with no password in it. */
  location: string;
  /** Applies the committed migrations. */
  ensureSchema: () => Promise<void>;
  /** Closes it after the server has drained. */
  close: () => Promise<void>;
}

/** Options for {@link openDatabase}. */
export interface OpenOptions {
  /**
   * Whether TLS is forced on for a remote host. Production only, so a developer's remote test database without TLS
   * still works locally.
   */
  isProduction: boolean;
}

/**
 * The node-postgres pool settings for a URL: TLS forced on in production for a host the internet could reach.
 *
 * @param connectionString - A postgres:// URL.
 * @param options - How to open it.
 * @returns The pool config.
 */
export function poolConfig(connectionString: string, options: OpenOptions): pg.PoolConfig {
  const mustForceSsl = options.isProduction && requiresSsl(connectionString);
  return { connectionString, ...(mustForceSsl ? { ssl: true } : {}) };
}

/**
 * Opens node-postgres against the router's Postgres. Nothing connects until the first query, so boot waits for it
 * with `waitForDatabase`.
 *
 * @param connectionString - A postgres:// URL, already checked by `databaseUrl` in env.ts.
 * @param options - How to open it.
 * @returns The database, not yet migrated.
 */
export function openDatabase(connectionString: string, options: OpenOptions): Database {
  const pool = new pg.Pool(poolConfig(connectionString, options));
  const db = drizzle({ client: pool, relations });
  const url = new URL(connectionString);
  return {
    db,
    location: `postgres ${url.hostname}${url.pathname}`,
    ensureSchema: async () => {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => pool.end(),
  };
}
