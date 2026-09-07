/**
 * A minimal stdio MCP server, spawned as a real child by the manager tests.
 *
 * Run directly by `process.execPath` — Node's type stripping handles the `.ts`,
 * which is the same thing `npm run dev:server` relies on. It offers one tool and
 * reports its own pid, so a test can tell one child from the one that replaced it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'echo', version: '1.0.0' });

server.tool('pid', 'Reports the server process pid.', {}, () => ({
  content: [{ type: 'text' as const, text: String(process.pid) }],
}));

await server.connect(new StdioServerTransport());
