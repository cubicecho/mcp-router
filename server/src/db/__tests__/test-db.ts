import { PGlite } from '@electric-sql/pglite';
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { inject } from 'vitest';
import { relations } from '../relations.ts';
import * as dbSchema from '../schema.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** The DDL for the current tables, worked out once per run by `global-setup.ts`. */
    schemaSql: string[];
  }
}

/** A database over PGlite in memory, as every test uses. */
export type TestDb = ReturnType<typeof drizzle<typeof relations>>;

/** Every table in the schema, quoted for a statement that names them all. */
const TABLE_LIST = Object.values(dbSchema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/**
 * Builds a fresh in-memory Postgres with the router's tables in it. A file makes one in `beforeAll`.
 *
 * @returns The db.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://');
  for (const statement of inject('schemaSql')) {
    await client.exec(statement);
  }
  return drizzle({ client, relations });
}

/**
 * Empties every table, so the next test starts from the db `createTestDb` returned.
 *
 * @param db - Test db.
 */
export async function resetTestDb(db: TestDb): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
}

/**
 * Shuts a test db down. An instance left open holds its whole Postgres in memory until the worker exits.
 *
 * @param db - Test db.
 */
export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}
