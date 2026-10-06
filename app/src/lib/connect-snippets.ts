export interface SnippetInput {
  endpoint: string;
  /** Client-side name for the server entry, e.g. "mcp-router" or the server's local name. */
  label: string;
  /** Bearer token value to embed, or undefined when auth is disabled. */
  token?: string;
}

export function claudeCodeSnippet({ endpoint, label, token }: SnippetInput): string {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : '';
  return `claude mcp add --transport http ${label} ${endpoint}${header}`;
}

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
