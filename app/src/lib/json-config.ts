/**
 * Parses a pasted JSON config into a single stdio server entry.
 *
 * @param text - A bare `{ command, args, env }` object, a named entry `{ "my-server": {...} }`, or a
 * `claude_desktop_config.json`-style `mcpServers` / `servers` wrapper. Trailing commas are tolerated.
 * @returns The first server found; `name` is undefined for a bare object, and `extraCount` is how many other
 * entries were skipped. Throws when the text is not JSON, has no entries, or the entry has no `command` string.
 */
export function parseJsonConfig(text: string): {
  name?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  extraCount: number;
} {
  // Tolerate trailing commas before a closing brace/bracket.
  const cleaned = text.replace(/,(\s*[}\]])/g, '$1');
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  // Unwrap a `mcpServers` / `servers` wrapper if present.
  const wrapper = parsed.mcpServers ?? parsed.servers;
  const map = wrapper && typeof wrapper === 'object' ? (wrapper as Record<string, unknown>) : parsed;

  let name: string | undefined;
  let entry: Record<string, unknown>;
  let extraCount = 0;
  if (typeof map.command === 'string') {
    // A bare `{ command, args, env }` config.
    entry = map;
  } else {
    // A name -> config map; use the first entry.
    const keys = Object.keys(map);
    const first = keys[0];
    if (!first) {
      throw new Error('No server entries found');
    }
    name = first;
    extraCount = keys.length - 1;
    const value = map[first];
    if (!value || typeof value !== 'object') {
      throw new Error(`Entry "${first}" is not an object`);
    }
    entry = value as Record<string, unknown>;
  }

  const command = entry.command;
  if (typeof command !== 'string' || !command) {
    throw new Error('Config has no "command" string');
  }
  const args = Array.isArray(entry.args) ? entry.args.map((a) => String(a)) : [];
  const env: Record<string, string> = {};
  if (entry.env && typeof entry.env === 'object') {
    for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }
  return { name, command, args, env, extraCount };
}
