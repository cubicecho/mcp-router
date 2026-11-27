import { describe, expect, it } from 'vitest';
import { type Queryable, waitForDatabase } from '../wait.ts';

/**
 * A database that fails its first queries, then answers.
 *
 * @param failures - What each early query throws, in order.
 * @returns The database and how many queries it was asked.
 */
function flakyDatabase(failures: unknown[]): { db: Queryable; calls: () => number } {
  let calls = 0;
  const db: Queryable = {
    execute: async () => {
      const failure = failures[calls];
      calls += 1;
      if (failure !== undefined) {
        throw failure;
      }
      return [];
    },
  };
  return { db, calls: () => calls };
}

/** Settings small enough that a test waits milliseconds. */
const FAST = { firstRetryDelayMs: 1, maxRetryDelayMs: 2, connectTimeoutMs: 1_000 };

describe('waitForDatabase', () => {
  it('retries while Postgres is still starting', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const starting = new Error('wrapped', { cause: { code: '57P03' } });
    const { db, calls } = flakyDatabase([refused, starting]);
    const logged: string[] = [];
    await waitForDatabase(db, FAST, (message) => logged.push(message));
    expect(calls()).toBe(3);
    expect(logged).toHaveLength(2);
  });

  it('fails at once on an error waiting will not cure', async () => {
    const badPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const { db, calls } = flakyDatabase([badPassword]);
    await expect(waitForDatabase(db, FAST, () => {})).rejects.toBe(badPassword);
    expect(calls()).toBe(1);
  });

  it('gives up once the time is up', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { db } = flakyDatabase(Array.from({ length: 1_000 }, () => refused));
    await expect(waitForDatabase(db, { ...FAST, connectTimeoutMs: 5 }, () => {})).rejects.toBe(refused);
  });
});
