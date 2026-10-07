import { readFileSync } from 'node:fs';
import { isRecord } from './is-record.ts';

/**
 * Version reported in RouterStatus and MCP server info.
 *
 * Read from the root package.json at load time so it tracks the released
 * version — semantic-release bumps that file (via `@semantic-release/npm`) at
 * release time, and the Dockerfile copies it into the runtime image. The path
 * is three levels up from this module in both dev (`server/src/core/version.ts`) and
 * prod (`server/dist/core/version.js`), so it resolves to the repo/app root in both.
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

export const SERVER_VERSION = readVersion();
