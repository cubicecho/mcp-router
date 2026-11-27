import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { DATABASE_DEFAULTS, type DatabaseSettings } from '../core/defaults.ts';

/**
 * What a database that is still starting looks like from here: nothing is listening, the name does not resolve yet,
 * or Postgres says so itself (57P03, "the database system is starting up"). Anything else is a real failure.
 */
const RETRYABLE_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  '57P03',
];

/** The least a database has to do for boot to ask whether it is up. */
export interface Queryable {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * The driver or errno code of `error`, or of whatever caused it. Drizzle wraps the driver's error.
 *
 * @param error - Whatever was thrown.
 * @returns The code, or undefined when there is none.
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cause' in error ? errorCode(error.cause) : undefined;
}

/**
 * Resolves once Postgres answers a query, retrying with capped backoff while it is still starting. Only the Postgres
 * branch needs it: PGlite is up once it is constructed.
 *
 * @param db - Anything that can run a query.
 * @param [overrides] - Settings that replace the defaults. Boot passes the connect timeout from the environment.
 * @param [log] - Where each retry is reported.
 * @returns Resolves once connected.
 * @throws A failure waiting will not cure (a wrong password, a missing database) at once, or the last error once the
 * time is up.
 */
export async function waitForDatabase(
  db: Queryable,
  overrides: Partial<DatabaseSettings> = {},
  log: (message: string) => void = console.warn,
): Promise<void> {
  const settings = { ...DATABASE_DEFAULTS, ...overrides };
  const deadline = Date.now() + settings.connectTimeoutMs;
  let delayMs = settings.firstRetryDelayMs;
  for (;;) {
    try {
      await db.execute(sql`select 1`);
      return;
    } catch (error) {
      const code = errorCode(error);
      const isWorthWaiting = code !== undefined && RETRYABLE_CODES.includes(code);
      const isOutOfTime = Date.now() + delayMs > deadline;
      if (isWorthWaiting === false || isOutOfTime) {
        throw error;
      }
      log(`[db] Postgres is not answering yet (${code}). Trying again in ${delayMs} ms.`);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * settings.retryBackoffFactor, settings.maxRetryDelayMs);
    }
  }
}
