import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, usesPostgres } from '../client.ts';
import { settings } from '../tables/settings.ts';

/** How long a test that creates a PGlite data dir on disk may take, in ms: the first open runs initdb. */
const PGLITE_DIR_TIMEOUT_MS = 60_000;

describe('usesPostgres', () => {
  it('tells a Postgres URL from a PGlite store', () => {
    expect(usesPostgres('postgres://router:pw@db:5432/router')).toBe(true);
    expect(usesPostgres('postgresql://db/router')).toBe(true);
    expect(usesPostgres('')).toBe(false);
    expect(usesPostgres('memory://')).toBe(false);
    expect(usesPostgres('/data/pg')).toBe(false);
  });
});

describe('openDatabase on a PGlite data dir', () => {
  let dataDir: string;
  let lockFile: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-pg-'));
    lockFile = path.join(dataDir, 'pg.lock');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(
    'uses DATA_DIR/pg when DATABASE_URL is unset, and keeps what was written across a reopen',
    async () => {
      const first = openDatabase('', dataDir);
      expect(first.isPostgres).toBe(false);
      await first.ensureSchema();
      await first.db.insert(settings).values({ instanceId: 'kept' });
      await first.close();

      const second = openDatabase('', dataDir);
      await second.ensureSchema();
      const [row] = await second.db.select().from(settings);
      expect(row?.instanceId).toBe('kept');
      await second.close();
    },
    PGLITE_DIR_TIMEOUT_MS,
  );

  it(
    'refuses a second process on the same data dir, and removes the lockfile on close',
    async () => {
      const first = openDatabase('', dataDir);
      expect(existsSync(lockFile)).toBe(true);
      // A running process that is not this one: the parent of the test runner's worker.
      await writeFile(lockFile, `${process.ppid}\n`);
      expect(() => openDatabase('', dataDir)).toThrow(/Another mcp-router \(pid \d+\) is using/);
      await first.close();
      expect(existsSync(lockFile)).toBe(false);
    },
    PGLITE_DIR_TIMEOUT_MS,
  );

  it(
    'takes over a lockfile left by a process that is gone',
    async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      await writeFile(lockFile, `${gone}\n`);
      const database = openDatabase('', dataDir);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stale lockfile'));
      await database.close();
    },
    PGLITE_DIR_TIMEOUT_MS,
  );
});
