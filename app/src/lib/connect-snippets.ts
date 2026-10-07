/** What a connection snippet is built from. */
export interface SnippetInput {
  /** Absolute URL of the MCP endpoint. */
  endpoint: string;
  /** Client-side name for the server entry, e.g. "mcp-router" or the server's local name. */
  label: string;
  /** Bearer token value to embed, or undefined when auth is disabled. */
  token?: string;
}

/**
 * Builds the `claude mcp add` command that registers an endpoint with Claude Code.
 *
 * @param props.endpoint - Absolute URL of the MCP endpoint.
 * @param props.label - Name the client files the server under.
 * @param props.token - Bearer token to embed as a header; left out when undefined or empty.
 * @returns The one-line shell command.
 */
export function claudeCodeSnippet({ endpoint, label, token }: SnippetInput): string {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : '';
  return `claude mcp add --transport http ${label} ${endpoint}${header}`;
}

/**
 * Builds an `mcpServers` JSON config entry for an endpoint.
 *
 * @param props.endpoint - Absolute URL of the MCP endpoint.
 * @param props.label - Key of the entry under `mcpServers`.
 * @param props.token - Bearer token to embed as a header; left out when undefined or empty.
 * @returns Pretty-printed JSON.
 */
export function mcpJsonSnippet({ endpoint, label, token }: SnippetInput): string {
  return JSON.stringify(
    {
      mcpServers: {
        [label]: {
          type: 'http',
          url: endpoint,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
    null,
    2,
  );
}

/**
 * Builds a `curl` command that sends `tools/list` to an endpoint.
 *
 * @param props.endpoint - Absolute URL of the MCP endpoint.
 * @param props.token - Bearer token to embed as a header; left out when undefined or empty.
 * @returns The command, one option per line.
 */
export function curlSnippet({ endpoint, token }: SnippetInput): string {
  const lines = [
    `curl -X POST ${endpoint} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Accept: application/json, text/event-stream" \\`,
  ];
  if (token) {
    lines.push(`  -H "Authorization: Bearer ${token}" \\`);
  }
  lines.push(`  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`);
  return lines.join('\n');
}

/**
 * Builds an opencode config with an endpoint as a remote MCP server.
 *
 * @param props.endpoint - Absolute URL of the MCP endpoint.
 * @param props.label - Key of the entry under `mcp`.
 * @param props.token - Bearer token to embed as a header; left out when undefined or empty.
 * @returns Pretty-printed JSON.
 */
export function opencodeSnippet({ endpoint, label, token }: SnippetInput): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        [label]: {
          type: 'remote',
          url: endpoint,
          enabled: true,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        },
      },
    },
    null,
    2,
  );
}
