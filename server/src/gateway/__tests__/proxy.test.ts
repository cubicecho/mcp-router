import type { ActivityEntry } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { createProxyServer, type ProxyDeps } from '../proxy.ts';

type RecordedActivity = ActivityEntry & { name: string };

/** Link a fresh proxy Server (over the given deps) to a real in-memory MCP Client. */
async function connectProxy(deps: ProxyDeps) {
  const server = createProxyServer('demo', deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

function collector() {
  const activity: RecordedActivity[] = [];
  const record = (name: string, entry: Omit<ActivityEntry, 'id'>) => {
    activity.push({ ...entry, id: activity.length + 1, name });
  };
  return { activity, record };
}

describe('proxy activity recording', () => {
  it('records successful list and call operations', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }),
      callTool: async (params: { arguments?: { msg?: string } }) => ({
        content: [{ type: 'text', text: `echo:${params.arguments?.msg}` }],
      }),
    };
    const deps: ProxyDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
    };
    const { client, close } = await connectProxy(deps);

    await client.listTools();
    await client.callTool({ name: 'echo', arguments: { msg: 'hi' } });
    await close();

    expect(activity).toHaveLength(2);
    expect(activity[0]).toMatchObject({ name: 'demo', method: 'tools/list', via: 'direct', ok: true });
    expect(activity[1]).toMatchObject({
      name: 'demo',
      method: 'tools/call',
      target: 'echo',
      via: 'direct',
      ok: true,
    });
    expect(activity[1]?.result).toMatchObject({ content: [{ type: 'text', text: 'echo:hi' }] });
    expect(typeof activity[1]?.durationMs).toBe('number');
  });

  it('records a failed tool call with its error message', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      callTool: async () => {
        throw new Error('downstream boom');
      },
    };
    const deps: ProxyDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
    };
    const { client, close } = await connectProxy(deps);

    await expect(client.callTool({ name: 'broken' })).rejects.toThrow();
    await close();

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ method: 'tools/call', target: 'broken', ok: false });
    expect(activity[0]?.error).toContain('downstream boom');
  });

  it('records a capability-less list as a successful empty result', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      listTools: async () => {
        throw new McpError(ErrorCode.MethodNotFound, 'no tools here');
      },
    };
    const deps: ProxyDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
    };
    const { client, close } = await connectProxy(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools).toEqual([]);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ method: 'tools/list', ok: true });
    expect(activity[0]?.result).toEqual({ tools: [] });
  });
});
