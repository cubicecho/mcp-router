import { authDisabledByEnv } from '../auth.ts';

/** The token `.env.example` ships with, which protects nothing once it is public. */
const PLACEHOLDER_TOKEN = 'change-me';

/** The highest TCP port number. */
const MAX_PORT = 65_535;

/**
 * The port to listen on: `PORT` when it is set, otherwise the one in settings.json.
 *
 * @param env - The process environment.
 * @param settingsPort - The port from settings.json.
 * @returns The port number.
 * @throws When `PORT` is set to something that is not a port number.
 */
export function listenPort(env: NodeJS.ProcessEnv, settingsPort: number): number {
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
 * Refuse to start with the placeholder token from `.env.example`.
 *
 * @param env - The process environment.
 * @throws When `MCP_ROUTER_TOKEN` is the placeholder and auth is on.
 */
export function refusePlaceholderToken(env: NodeJS.ProcessEnv): void {
  if (env.MCP_ROUTER_TOKEN === PLACEHOLDER_TOKEN && authDisabledByEnv(env) === false) {
    throw new Error(
      `MCP_ROUTER_TOKEN is still the placeholder "${PLACEHOLDER_TOKEN}" from .env.example. ` +
        'Set it to a long random value (openssl rand -hex 32), or remove it to have one generated.',
    );
  }
}
