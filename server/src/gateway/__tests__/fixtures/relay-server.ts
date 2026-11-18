/**
 * A stdio MCP server for what a proxy relays beyond the request itself: progress, resource links, subscriptions, log
 * lines, and questions put back to the caller.
 *
 * Spawned as a real child, like `echo-server.ts`. It reports which URIs its one connection is subscribed to, which is
 * the only way a test can see what the router forwarded and what it kept back.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const NOTE_URI = 'relay://note';

const server = new McpServer({ name: 'relay', version: '1.0.0' });
const subscribed = new Set<string>();

server.tool('progress', 'Reports two steps of progress, then finishes.', {}, async (_args, extra) => {
  const progressToken = extra._meta?.progressToken;
  if (progressToken !== undefined) {
    for (const progress of [1, 2]) {
      await extra.sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total: 2 } });
    }
  }
  return { content: [{ type: 'text' as const, text: 'done' }] };
});

server.tool('link', 'Links to the note.', {}, () => ({
  content: [{ type: 'resource_link' as const, uri: NOTE_URI, name: 'note' }],
}));

server.tool('subscriptions', 'Lists the URIs this connection is subscribed to.', {}, () => ({
  content: [{ type: 'text' as const, text: JSON.stringify([...subscribed].sort()) }],
}));

server.tool('log', 'Logs one line, then finishes.', {}, async () => {
  await server.server.sendLoggingMessage({ level: 'info', data: 'working' });
  return { content: [{ type: 'text' as const, text: 'logged' }] };
});

server.tool('ask', 'Asks the caller for a name and answers with what came back.', {}, async () => {
  const answer = await server.server.elicitInput({
    message: 'Who is asking?',
    requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(answer) }] };
});

server.resource('note', NOTE_URI, async (uri) => ({ contents: [{ uri: uri.href, text: 'hello' }] }));

server.server.registerCapabilities({ resources: { subscribe: true }, logging: {} });
server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
  subscribed.add(req.params.uri);
  return {};
});
server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
  subscribed.delete(req.params.uri);
  return {};
});

await server.connect(new StdioServerTransport());
