// The one module that reads `process.env`. Every getter reads at call time and takes the environment as an
// argument, so a test passes its own.
import path from 'node:path';
import { HTTP_DEFAULTS } from '../defaults.ts';

/** The token `.env.example` ships with, which protects nothing once it is public. */
const PLACEHOLDER_TOKEN = 'change-me';

/** The highest TCP port number. */
const MAX_PORT = 65_535;

/** Where config and installed packages live when `DATA_DIR` is unset. */
const DEFAULT_DATA_DIR = './data';

/** The values of a switch variable that turn it on. */
const TRUTHY_ENV = new Set(['1', 'true', 'yes', 'on']);

/**
 * Reads a millisecond duration from an env value.
 *
 * @param value - Raw env value.
 * @param fallback - Used when the value is unset, not a whole number, or below `min`.
 * @param min - Smallest accepted value.
 * @returns The duration in ms.
 */
function envMs(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value?.trim() || Number.NaN);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * The directory config and installed packages live in: `DATA_DIR`, or `./data`.
 *
 * @param env - The process environment.
 * @returns The absolute path.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.DATA_DIR ?? DEFAULT_DATA_DIR);
}

/**
 * The port to listen on: `PORT` when it is set, otherwise the one in settings.json.
 *
 * @param settingsPort - The port from settings.json.
 * @param env - The process environment.
 * @returns The port number.
 * @throws When `PORT` is set to something that is not a port number.
 */
export function listenPort(settingsPort: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw === '') {
    return settingsPort;
  }
  const port = Number(raw);
  const isPort = Number.isInteger(port) && port >= 0 && port <= MAX_PORT;
  if (isPort === false) {
    throw new Error(`PORT is "${raw}", which is not a port number. Set it to a whole number from 0 to ${MAX_PORT}.`);
  }
  return port;
}

/**
 * The interface to bind: `HOST` when it is set, otherwise the one in settings.json.
 *
 * @param settingsHost - The host from settings.json.
 * @param env - The process environment.
 * @returns The host, or undefined to bind every interface.
 */
export function listenHost(settingsHost: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HOST ?? settingsHost;
}

/**
 * Whether `SECURE_LOCAL_NET` has turned bearer auth off for /api and /mcp. It overrides `authEnabled` in
 * settings.json, for a trusted local network where minting and passing tokens is not worth it.
 *
 * @param env - The process environment.
 * @returns True when the variable is set to a truthy value.
 */
export function authDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SECURE_LOCAL_NET;
  return value !== undefined && TRUTHY_ENV.has(value.trim().toLowerCase());
}

/**
 * The bearer token from `MCP_ROUTER_TOKEN`, which replaces the one stored in settings.json.
 *
 * @param env - The process environment.
 * @returns The token, or undefined when the variable is unset or empty (compose passes an unset variable as '').
 */
export function envToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MCP_ROUTER_TOKEN || undefined;
}

/**
 * Idle time before an inbound keep-alive connection is closed: `HTTP_KEEP_ALIVE_TIMEOUT_MS`, or the default.
 *
 * @param env - The process environment. `0` never closes an idle connection.
 * @returns The timeout in ms.
 */
export function keepAliveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, HTTP_DEFAULTS.keepAliveTimeoutMs, 0);
}

/**
 * Idle time before an outbound connection is closed: `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS`, or the default.
 *
 * @param env - The process environment. The default applies when the value is not a positive whole number.
 * @returns The timeout in ms.
 */
export function outboundKeepAliveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return envMs(env.HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS, HTTP_DEFAULTS.outboundKeepAliveTimeoutMs, 1);
}

/**
 * Refuse to start with the placeholder token from `.env.example`.
 *
 * @param env - The process environment.
 * @throws When `MCP_ROUTER_TOKEN` is the placeholder and auth is on.
 */
export function refusePlaceholderToken(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MCP_ROUTER_TOKEN === PLACEHOLDER_TOKEN && authDisabledByEnv(env) === false) {
    throw new Error(
      `MCP_ROUTER_TOKEN is still the placeholder "${PLACEHOLDER_TOKEN}" from .env.example. ` +
        'Set it to a long random value (openssl rand -hex 32), or remove it to have one generated.',
    );
  }
}
