import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { relations } from './relations.ts';

/** A Drizzle client over the router's tables, whichever Postgres driver opened it (PGlite in tests). */
export type RouterDb = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;

/** The transaction a write and its hooks run in. */
export type RouterTx = Parameters<Parameters<RouterDb['transaction']>[0]>[0];
