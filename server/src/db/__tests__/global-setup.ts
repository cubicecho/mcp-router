import { PGlite } from '@electric-sql/pglite';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import type { TestProject } from 'vitest/node';
import * as dbSchema from '../schema.ts';

// drizzle-kit is seconds of import and hundreds of megabytes in every process that loads it,
// so the tables are diffed once here and the workers get the SQL.

/**
 * Works out the DDL for the current tables against an empty database, and hands it to the test files as `schemaSql`.
 *
 * @param project - The Vitest project whose workers read the statements.
 */
export default async function setup(project: TestProject): Promise<void> {
  const client = new PGlite('memory://');
  const { sqlStatements } = await pushSchema(dbSchema, drizzle({ client }));
  await client.close();
  project.provide('schemaSql', sqlStatements);
}
