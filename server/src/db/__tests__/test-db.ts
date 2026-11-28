// The database every server test uses: PGlite in memory, migrated with the committed migrations. PGlite is for tests
// only: the router itself always runs on the Postgres that DATABASE_URL names.
import { PGlite } from '@electric-sql/pglite';
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { ConfigStore } from '../../config/store.ts';
import { type Database, MIGRATIONS_FOLDER } from '../client.ts';
import { relations } from '../relations.ts';
import * as dbSchema from '../schema.ts';

/** Every table in the schema, quoted for a statement that names them all. */
const TABLE_LIST = Object.values(dbSchema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/**
 * Opens PGlite in memory: nothing on disk, gone when it closes.
 *
 * @returns The database, not yet migrated.
 */
export function openTestDatabase(): Database {
  const client = new PGlite('memory://');
  const db = drizzle({ client, relations });
  return {
    db,
    location: 'PGlite memory://',
    ensureSchema: async () => {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: () => client.close(),
  };
}

/**
 * Builds a fresh in-memory Postgres with the tables in it.
 *
 * @returns The database. A file makes one in `beforeAll`, empties it with `resetTestDb` between tests, and closes it in
 * `afterAll`: booting one takes about a second.
 */
export async function createTestDb(): Promise<Database> {
  const database = openTestDatabase();
  await database.ensureSchema();
  return database;
}

/**
 * Empties every table, so the next test starts from an empty database.
 *
 * @param database - A database from `createTestDb`.
 */
export async function resetTestDb(database: Database): Promise<void> {
  await database.db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
}

/**
 * Builds a store over a test database and runs its first boot.
 *
 * @param database - A database from `createTestDb`, usually just reset.
 * @param dataDir - The data directory, whose `config` folder is imported when it has files.
 * @returns The initialised store.
 */
export async function createTestStore(database: Database, dataDir: string): Promise<ConfigStore> {
  const store = new ConfigStore({ db: database.db, dataDir });
  await store.init();
  return store;
}
