/**
 * A minimal stdio MCP server, spawned as a real child by the manager tests.
 *
 * Run directly by `process.execPath` — Node's type stripping handles the `.ts`,
 * which is the same thing `npm run dev:server` relies on. It reports its own pid, so
 * a test can tell one child from the one that replaced it, and the `clientInfo` it was
 * dialled with; it carries `instructions` so a test can follow those through the gateway.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ECHO_INSTRUCTIONS } from './echo-instructions.ts';

const server = new McpServer({ name: 'echo', version: '1.0.0' }, { instructions: ECHO_INSTRUCTIONS });

server.tool('pid', 'Reports the server process pid.', {}, () => ({
  content: [{ type: 'text' as const, text: String(process.pid) }],
}));

server.tool('caller', 'Reports the clientInfo this server was dialled with.', {}, () => {
  const client = server.server.getClientVersion();
  return { content: [{ type: 'text' as const, text: `${client?.name} ${client?.version}` }] };
});

await server.connect(new StdioServerTransport());
