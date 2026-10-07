import { readFileSync } from 'node:fs';
import { isRecord } from './is-record.ts';

/**
 * Reads the released version from the root package.json.
 *
 * @returns The version, or `0.0.0` when the file is missing, unreadable or has none.
 *
 * @remarks
 * semantic-release bumps that file at release time and the Dockerfile copies it into the runtime image. The path is
 * three levels up from this module in both dev (`server/src/core/version.ts`) and prod (`server/dist/core/version.js`).
 */
function readVersion(): string {
  try {
    const pkgUrl = new URL('../../../package.json', import.meta.url);
    const pkg: unknown = JSON.parse(readFileSync(pkgUrl, 'utf8'));
    return isRecord(pkg) && typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Version reported in RouterStatus and MCP server info, read once at load. */
export const SERVER_VERSION = readVersion();
