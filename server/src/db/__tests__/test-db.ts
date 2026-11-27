// The database every server test uses: PGlite in memory, migrated with the committed migrations.
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { ConfigStore } from '../../config/store.ts';
import { type Database, MEMORY_STORE, openDatabase } from '../client.ts';
import * as dbSchema from '../schema.ts';

/** Every table in the schema, quoted for a statement that names them all. */
const TABLE_LIST = Object.values(dbSchema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/**
 * Builds a fresh in-memory Postgres with the tables in it.
 *
 * @returns The database. A file makes one in `beforeAll`, empties it with `resetTestDb` between tests, and closes it in
 * `afterAll`: booting one takes about a second.
 */
export async function createTestDb(): Promise<Database> {
  const database = openDatabase(MEMORY_STORE, '');
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
