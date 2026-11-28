import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** The entry point, run as `node server/src/index.ts` runs it. */
const ENTRY = path.resolve(import.meta.dirname, '../index.ts');
/** How long one refused boot may take, in ms: it exits before opening anything. */
const BOOT_TIMEOUT_MS = 30_000;

const dataDir = mkdtempSync(path.join(tmpdir(), 'mcp-router-boot-'));

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Boots the router with only the given variables beside PATH and the data dir.
 *
 * @param env - The extra environment.
 * @returns The exit status and stderr.
 */
function boot(env: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [ENTRY], {
    env: { PATH: process.env.PATH, DATA_DIR: dataDir, PORT: '0', ...env },
    encoding: 'utf8',
    timeout: BOOT_TIMEOUT_MS,
  });
  return { status: result.status, stderr: result.stderr };
}

describe('boot', () => {
  it(
    'refuses to start without DATABASE_URL, and says so',
    () => {
      const { status, stderr } = boot({});
      expect(status).toBe(1);
      expect(stderr).toContain('[db] DATABASE_URL is not set');
    },
    BOOT_TIMEOUT_MS,
  );

  it(
    'refuses a DATABASE_URL that is not Postgres',
    () => {
      const { status, stderr } = boot({ DATABASE_URL: 'memory://' });
      expect(status).toBe(1);
      expect(stderr).toContain('[db] DATABASE_URL must be a postgres:// or postgresql:// URL');
    },
    BOOT_TIMEOUT_MS,
  );
});
