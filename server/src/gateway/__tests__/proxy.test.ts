import type { ActivityEntry } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../errors.ts';
import { type AggregateDeps, createAggregateServer, createProxyServer, type ProxyDeps } from '../proxy.ts';

type RecordedActivity = ActivityEntry & { name: string };

/** Link the given gateway Server to a real in-memory MCP Client. */
async function connect(server: Server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

const connectProxy = (deps: ProxyDeps) => connect(createProxyServer('demo', deps));
const connectAggregate = (deps: AggregateDeps) => connect(createAggregateServer(deps));

function collector() {
  const activity: RecordedActivity[] = [];
  const record = (name: string, entry: Omit<ActivityEntry, 'id'>) => {
    activity.push({ ...entry, id: activity.length + 1, name });
  };
  return { activity, record };
}

/** Minimal ProxyDeps over a stubbed downstream client; override pieces per test. */
function stubDeps(fakeClient: unknown, overrides: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    getClient: async () => fakeClient as Client,
    recordToolCount: () => {},
    recordActivity: () => {},
    ...overrides,
  };
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
    const { client, close } = await connectProxy(stubDeps(fakeClient, { recordActivity: record }));

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

  it('surfaces HttpError detail (e.g. a stderr tail) in the recorded error', async () => {
    const { activity, record } = collector();
    const deps = stubDeps(null, {
      recordActivity: record,
      getClient: async () => {
        throw new HttpError(502, 'Failed to connect to server "demo"', 'Traceback: ModuleNotFoundError: mcp');
      },
    });
    const { client, close } = await connectProxy(deps);

    await expect(client.callTool({ name: 'echo' })).rejects.toThrow(/ModuleNotFoundError/);
    await close();

    expect(activity).toHaveLength(1);
    expect(activity[0]?.error).toContain('ModuleNotFoundError');
  });

  it('records a failed direct list', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      listTools: async () => {
        throw new Error('connection reset');
      },
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient, { recordActivity: record }));

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
    const { client, close } = await connectProxy(stubDeps(fakeClient, { recordActivity: record }));

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
    const { client, close } = await connectProxy(stubDeps(fakeClient, { recordActivity: record }));

    const result = await client.callTool({ name: 'echo', arguments: {} });
    await close();

    // The isError result must still reach the client unmodified.
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ method: 'tools/call', target: 'echo', ok: false });
    expect(activity[0]?.error).toContain('boom');
  });

  it('serves a capability-less list as an empty result, resetting the tool count, without recording it', async () => {
    const { activity, record } = collector();
    const toolCounts: Record<string, number> = {};
    const fakeClient = {
      listTools: async () => {
        throw new McpError(ErrorCode.MethodNotFound, 'no tools here');
      },
    };
    const deps = stubDeps(fakeClient, {
      recordActivity: record,
      recordToolCount: (name, count) => {
        toolCounts[name] = count;
      },
    });
    const { client, close } = await connectProxy(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools).toEqual([]);
    expect(toolCounts.demo).toBe(0);
    expect(activity).toEqual([]);
  });
});

describe('aggregate activity recording', () => {
  it('records a routed tools/call under the owning server and honors isError', async () => {
    const { activity, record } = collector();
    const fakeClient = {
      callTool: async () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient, { recordActivity: record }), serverNames: () => ['alpha'] };
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
      ...stubDeps(fakeClient, { recordActivity: record }),
      serverNames: () => ['alpha', 'beta'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools.map((t) => t.name).sort()).toEqual(['alpha__echo', 'beta__echo']);
    expect(activity).toEqual([]);
  });

  it('merges and namespaces resource templates across servers', async () => {
    const fakeClient = {
      listResourceTemplates: async () => ({
        resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'Files' }],
      }),
    };
    const deps: AggregateDeps = {
      ...stubDeps(fakeClient),
      serverNames: () => ['alpha', 'beta'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listResourceTemplates();
    await close();

    expect(result.resourceTemplates).toEqual([
      { uriTemplate: 'alpha__file:///{path}', name: 'alpha__Files' },
      { uriTemplate: 'beta__file:///{path}', name: 'beta__Files' },
    ]);
  });

  it('drains every page of a paginating downstream list', async () => {
    const { activity, record } = collector();
    const toolCounts: Record<string, number> = {};
    const fakeClient = {
      listTools: async (params?: { cursor?: string }) =>
        params?.cursor === 'page2'
          ? { tools: [{ name: 'two', inputSchema: { type: 'object' } }] }
          : { tools: [{ name: 'one', inputSchema: { type: 'object' } }], nextCursor: 'page2' },
    };
    const deps: AggregateDeps = {
      ...stubDeps(fakeClient, {
        recordActivity: record,
        recordToolCount: (name, count) => {
          toolCounts[name] = count;
        },
      }),
      serverNames: () => ['alpha'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools.map((t) => t.name)).toEqual(['alpha__one', 'alpha__two']);
    expect(toolCounts.alpha).toBe(2);
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
      ...stubDeps(null, {
        recordActivity: record,
        getClient: async (name) => (name === 'bad' ? badClient : goodClient) as Client,
      }),
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
