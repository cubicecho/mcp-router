import type { ActivityEntry } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { type AggregateDeps, createAggregateServer, createProxyServer, type ProxyDeps } from '../proxy.ts';

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

/** Link a fresh aggregate Server (over the given deps) to a real in-memory MCP Client. */
async function connectAggregate(deps: AggregateDeps) {
  const server = createAggregateServer(deps);
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
  it('records successful calls but not routine list successes', async () => {
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

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      name: 'demo',
      method: 'tools/call',
      target: 'echo',
      via: 'direct',
      ok: true,
    });
    expect(activity[0]?.result).toMatchObject({ content: [{ type: 'text', text: 'echo:hi' }] });
    expect(typeof activity[0]?.durationMs).toBe('number');
  });

  it('records a failed direct list', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      listTools: async () => {
        throw new Error('connection reset');
      },
    };
    const deps: ProxyDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
    };
    const { client, close } = await connectProxy(deps);

    await expect(client.listTools()).rejects.toThrow();
    await close();

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ method: 'tools/list', ok: false });
    expect(activity[0]?.error).toContain('connection reset');
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

  it('records a tool call that resolves with isError as a failure', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      callTool: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    };
    const deps: ProxyDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
    };
    const { client, close } = await connectProxy(deps);

    const result = await client.callTool({ name: 'echo', arguments: {} });
    await close();

    // The isError result must still reach the client unmodified.
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ method: 'tools/call', target: 'echo', ok: false });
    expect(activity[0]?.error).toContain('boom');
  });

  it('serves a capability-less list as an empty result without recording it', async () => {
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
    expect(activity).toEqual([]);
  });
});

describe('aggregate activity recording', () => {
  it('records a routed tools/call under the owning server and honors isError', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      callTool: async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    };
    const deps: AggregateDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
      serverNames: () => ['alpha'],
    };
    const { client, close } = await connectAggregate(deps);

    await client.callTool({ name: 'alpha__echo', arguments: {} });
    await close();

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      name: 'alpha',
      method: 'tools/call',
      target: 'echo',
      via: 'aggregate',
      ok: false,
    });
    expect(activity[0]?.error).toContain('nope');
  });

  it('does not record routine aggregate list fan-outs', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }),
    };
    const deps: AggregateDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async () => fakeClient as any,
      recordToolCount: () => {},
      recordActivity: record,
      serverNames: () => ['alpha', 'beta'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools.map((t) => t.name).sort()).toEqual(['alpha__echo', 'beta__echo']);
    expect(activity).toEqual([]);
  });

  it('records a server that errors during the aggregate list fan-out, and still serves the rest', async () => {
    const { activity, record } = collector();
    const goodClient = {
      listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }),
    };
    const badClient = {
      listTools: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    };
    const deps: AggregateDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: minimal downstream stub
      getClient: async (name: string) => (name === 'bad' ? badClient : goodClient) as any,
      recordToolCount: () => {},
      recordActivity: record,
      serverNames: () => ['bad', 'good'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools.map((t) => t.name)).toEqual(['good__echo']);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ name: 'bad', method: 'tools/list', via: 'aggregate', ok: false });
    expect(activity[0]?.error).toContain('ECONNREFUSED');
  });
});
