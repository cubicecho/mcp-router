// `npm run codegen`: prints the schema /graphql serves, so the UI's types can be generated from the real thing.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/pglite';
import { printSchema } from 'graphql';
import { relations } from '../db/relations.ts';
import { createSchema } from './build-schema.ts';

// Building the schema runs no query, so a client with no database behind it will do.
const db = drizzle.mock({ relations });
const outputDir = path.resolve(import.meta.dirname, '../../__generated__');
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'schema.graphql'), printSchema(createSchema(db).schema), 'utf-8');
console.log(`[graphql] wrote ${path.join(outputDir, 'schema.graphql')}`);
