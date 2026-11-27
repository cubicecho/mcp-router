import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { errorMessage } from '../core/errors.ts';

/** A data dir this process owns until it lets go. */
export interface PidLock {
  /** Removes the lockfile. Safe to call twice. */
  release: () => void;
}

/**
 * Whether a process is running.
 *
 * @param pid - The process id.
 * @returns True when it exists, even when it belongs to another user.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    return code === 'EPERM';
  }
}

/**
 * Reads the pid a lockfile holds.
 *
 * @param file - The lockfile.
 * @returns The pid, or undefined when the file is gone or holds no number.
 */
function readPid(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    // Gone between the failed create and this read: nobody holds it.
    return undefined;
  }
}

/**
 * Claims a PGlite data dir with a pid lockfile, or refuses. PGlite is single-process: two routers on one data dir
 * would corrupt it.
 *
 * @param file - The lockfile, beside the data dir.
 * @param what - The data dir, named in the refusal.
 * @returns The lock. A stale one (its process is gone, or it was this pid, as after a container restart) is taken over.
 * @throws When another running process holds the lock.
 */
export function claimPidLock(file: string, what: string): PidLock {
  try {
    writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'EEXIST') {
      throw new Error(`Could not create the lockfile ${file}: ${errorMessage(error)}`, { cause: error });
    }
    const holder = readPid(file);
    const isHeld = holder !== undefined && holder !== process.pid && isRunning(holder);
    if (isHeld) {
      throw new Error(
        `Another mcp-router (pid ${holder}) is using ${what}. PGlite allows one process per data dir: stop that one first, or point DATABASE_URL at Postgres.`,
      );
    }
    console.warn(`[db] taking over the stale lockfile ${file}${holder === undefined ? '' : ` (pid ${holder})`}`);
    writeFileSync(file, `${process.pid}\n`);
  }
  let isClaimed = true;
  return {
    release: () => {
      if (isClaimed === false) {
        return;
      }
      isClaimed = false;
      rmSync(file, { force: true });
    },
  };
}
