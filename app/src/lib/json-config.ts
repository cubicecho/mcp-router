import { fromMcpServersJson, type McpServerConfig, validateServerConfig } from '@cubicecho/agent-mcp-pool/servers';
import { type ServerTransport, TRANSPORT_STDIO, TRANSPORT_STREAMABLE_HTTP } from '@mcp-router/shared';

/** What a pasted config fills the add-server form with: its first server. */
export interface PastedServer {
  /** The key the server was listed under; undefined for a bare `{ command, … }` body. */
  name?: string;
  transport: ServerTransport;
  /** The child's env; empty for an HTTP server. */
  env: Record<string, string>;
  /** How many other servers the paste held, which the form does not use. */
  extraCount: number;
}

/**
 * The id handed to the pool's importer for a bare body, which has no key of its own to take one from.
 *
 * Starts with a NUL so that no real config's key matches it: a row carrying it came from a bare body.
 */
const BARE_BODY = '\u0000bare';

/**
 * Reads a pasted `mcpServers` config with the pool's importer, for the add-server form.
 *
 * @param text - A `claude_desktop_config.json`-style `mcpServers` / `servers` wrapper, a named entry
 * `{ "my-server": {...} }`, or a bare `{ command, args, env }` (or `{ url, headers }`) body. Trailing commas are
 * tolerated.
 * @returns The first server, mapped onto the router's transport; `extraCount` is how many others were skipped.
 *
 * @remarks
 * Throws the importer's message when the text is not JSON, holds no server or names a transport the router cannot
 * reach (SSE), and the validator's when the first server is unusable, such as a stdio server with no command. Args and
 * env values are stringified, as `8080` in an env is a common hand-written slip. `${VAR}` placeholders are left as
 * written: the browser has no env to fill them from, and the env rows are where the operator fills them in.
 */
export function importPastedServer(text: string): PastedServer {
  // Trailing commas before a closing brace or bracket are the usual copy-paste artifact; JSON refuses them.
  const cleaned = text.replace(/,(\s*[}\]])/g, '$1');
  const [first, ...rest] = fromMcpServersJson(cleaned, { env: {}, name: BARE_BODY });
  // The importer throws rather than return no rows, so `first` is always there.
  const row = stringified(first as McpServerConfig);
  const name = row.id === BARE_BODY ? undefined : row.id;

  // The router names a server by the Local name field, so the key's fitness as a tool namespace is not this form's
  // problem: validate under a slug that always passes, leaving only what the row would run with.
  const problems = validateServerConfig({ ...row, slug: 'pasted' });
  if (problems.length > 0) {
    throw new Error(name ? `server "${name}": ${problems.join('; ')}` : problems.join('; '));
  }

  if (row.transport === 'http') {
    return {
      name,
      transport: { type: TRANSPORT_STREAMABLE_HTTP, url: row.url, headers: row.headers ?? {} },
      env: {},
      extraCount: rest.length,
    };
  }
  return {
    name,
    transport: { type: TRANSPORT_STDIO, command: row.command, args: row.args ?? [], cwd: row.cwd ?? undefined },
    env: row.env ?? {},
    extraCount: rest.length,
  };
}

/**
 * A row with its args, env and headers as strings, as the form's text fields and key-value rows hold them.
 *
 * @param row - The importer's row, whose values are whatever the JSON held.
 * @returns The row with each of those values passed through `String`.
 */
function stringified(row: McpServerConfig): McpServerConfig {
  if (row.transport === 'http') {
    return row.headers ? { ...row, headers: stringValues(row.headers) } : row;
  }
  return {
    ...row,
    ...(row.args ? { args: row.args.map((arg: unknown) => String(arg)) } : {}),
    ...(row.env ? { env: stringValues(row.env) } : {}),
  };
}

/**
 * @param record - A map whose values may be numbers or booleans.
 * @returns The same map with every value a string.
 */
function stringValues(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));
}
