import type { ActivityEntry } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ErrorCode, McpError, type Progress } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { upstreamFailed } from '../../core/errors.ts';
import { type AggregateDeps, createAggregateServer } from '../aggregate-proxy.ts';
import { proxyCapabilities } from '../capability.ts';
import { createProxyServer } from '../direct-proxy.ts';
import { mergeInstructions } from '../instructions.ts';
import { SubscriptionLedger } from '../subscriptions.ts';
import type { ProxyDeps } from '../track.ts';

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
  // A ledger of its own, so the sessions of one test count against each other and no other test's.
  const ledger = new SubscriptionLedger();
  return {
    withClient: async (_name, run) => run(fakeClient as Client),
    recordToolCount: () => {},
    recordActivity: () => {},
    callTimeoutMs: () => 60_000,
    holdSubscription: (name, uri, session) => ledger.hold(name, uri, session),
    releaseSubscription: (name, uri, session) => ledger.release(name, uri, session),
    releaseSubscriptions: (session) => {
      ledger.releaseAll(session);
    },
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
      withClient: async () => {
        throw upstreamFailed('Failed to connect to server "demo"', 'Traceback: ModuleNotFoundError: mcp');
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

  it('skips and records a downstream that repeats a tools/list cursor, rather than truncating it', async () => {
    const { activity, record } = collector();
    const loopingClient = {
      listTools: async () => ({ tools: [{ name: 'again', inputSchema: { type: 'object' } }], nextCursor: 'same' }),
    };
    const deps: AggregateDeps = {
      ...stubDeps(loopingClient, { recordActivity: record }),
      serverNames: () => ['alpha'],
    };
    const { client, close } = await connectAggregate(deps);

    const result = await client.listTools();
    await close();

    expect(result.tools).toEqual([]);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ name: 'alpha', method: 'tools/list', via: 'aggregate', ok: false });
    expect(activity[0]?.error).toContain('repeated the tools/list cursor');
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
        withClient: async (name, run) => run((name === 'bad' ? badClient : goodClient) as Client),
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

describe('completions passthrough', () => {
  it('forwards a completion request on the per-server endpoint', async () => {
    const fakeClient = {
      complete: async (params: { ref: { name: string } }) => ({
        completion: { values: [`${params.ref.name}:done`] },
      }),
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'greet' },
      argument: { name: 'who', value: 'a' },
    });
    await close();

    expect(result.completion.values).toEqual(['greet:done']);
  });

  it('returns empty values when the downstream lacks the completions capability', async () => {
    const fakeClient = {
      complete: async () => {
        throw new McpError(ErrorCode.MethodNotFound, 'no completions');
      },
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'file:///x' },
      argument: { name: 'p', value: '' },
    });
    await close();

    expect(result.completion.values).toEqual([]);
  });

  it('strips the namespace off a completion ref and routes to the owning server', async () => {
    let seenRef: unknown;
    const fakeClient = {
      complete: async (params: { ref: unknown }) => {
        seenRef = params.ref;
        return { completion: { values: ['ok'] } };
      },
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['alpha', 'beta'] };
    const { client, close } = await connectAggregate(deps);

    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'alpha__greet' },
      argument: { name: 'who', value: '' },
    });
    await close();

    expect(seenRef).toEqual({ type: 'ref/prompt', name: 'greet' });
    expect(result.completion.values).toEqual(['ok']);
  });
});

describe('resource subscriptions', () => {
  it('forwards subscribe and unsubscribe on the per-server endpoint', async () => {
    const calls: Array<[string, string]> = [];
    const fakeClient = {
      subscribeResource: async (p: { uri: string }) => {
        calls.push(['sub', p.uri]);
        return {};
      },
      unsubscribeResource: async (p: { uri: string }) => {
        calls.push(['unsub', p.uri]);
        return {};
      },
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    await client.subscribeResource({ uri: 'file:///x' });
    await client.unsubscribeResource({ uri: 'file:///x' });
    await close();

    expect(calls).toEqual([
      ['sub', 'file:///x'],
      ['unsub', 'file:///x'],
    ]);
  });

  it('strips the namespace off a subscribed resource uri on the aggregate', async () => {
    let seen: string | undefined;
    const fakeClient = {
      subscribeResource: async (p: { uri: string }) => {
        seen = p.uri;
        return {};
      },
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['alpha'] };
    const { client, close } = await connectAggregate(deps);

    await client.subscribeResource({ uri: 'alpha__file:///x' });
    await close();

    expect(seen).toBe('file:///x');
  });
  it('keeps a subscription another session still holds when one session unsubscribes', async () => {
    const calls: Array<[string, string]> = [];
    const fakeClient = {
      subscribeResource: async (p: { uri: string }) => {
        calls.push(['sub', p.uri]);
        return {};
      },
      unsubscribeResource: async (p: { uri: string }) => {
        calls.push(['unsub', p.uri]);
        return {};
      },
    };
    // One deps for both sessions: they share a downstream connection, as two clients of /mcp do.
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['alpha'] };
    const first = await connectAggregate(deps);
    const second = await connectAggregate(deps);

    await first.client.subscribeResource({ uri: 'alpha__file:///x' });
    await second.client.subscribeResource({ uri: 'alpha__file:///x' });
    await first.client.unsubscribeResource({ uri: 'alpha__file:///x' });
    // The second session is still subscribed, so the downstream has not been told.
    expect(calls).toEqual([
      ['sub', 'file:///x'],
      ['sub', 'file:///x'],
    ]);

    await second.client.unsubscribeResource({ uri: 'alpha__file:///x' });
    await Promise.all([first.close(), second.close()]);

    expect(calls.at(-1)).toEqual(['unsub', 'file:///x']);
  });

  it('counts the per-server endpoint and the aggregate against one another', async () => {
    const calls: string[] = [];
    const fakeClient = {
      subscribeResource: async () => {
        calls.push('sub');
        return {};
      },
      unsubscribeResource: async () => {
        calls.push('unsub');
        return {};
      },
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['demo'] };
    const direct = await connectProxy(deps);
    const aggregate = await connectAggregate(deps);

    await direct.client.subscribeResource({ uri: 'file:///x' });
    await aggregate.client.subscribeResource({ uri: 'demo__file:///x' });
    await direct.client.unsubscribeResource({ uri: 'file:///x' });
    await Promise.all([direct.close(), aggregate.close()]);

    expect(calls).toEqual(['sub', 'sub']);
  });

  it("lets go of a closed session's subscriptions, so the last holder's unsubscribe reaches the downstream", async () => {
    const calls: string[] = [];
    const fakeClient = {
      subscribeResource: async () => {
        calls.push('sub');
        return {};
      },
      unsubscribeResource: async () => {
        calls.push('unsub');
        return {};
      },
    };
    const released: object[] = [];
    const base = stubDeps(fakeClient);
    const deps: AggregateDeps = {
      ...base,
      releaseSubscriptions: (session) => {
        released.push(session);
        base.releaseSubscriptions(session);
      },
      serverNames: () => ['alpha'],
    };
    const gone = await connectAggregate(deps);
    const staying = await connectAggregate(deps);

    await gone.client.subscribeResource({ uri: 'alpha__file:///x' });
    await staying.client.subscribeResource({ uri: 'alpha__file:///x' });
    await gone.close();
    await staying.client.unsubscribeResource({ uri: 'alpha__file:///x' });
    await staying.close();

    // Each session let go of what it held as it closed (the in-memory pair reports a close from both ends).
    expect(new Set(released).size).toBe(2);
    expect(calls).toEqual(['sub', 'sub', 'unsub']);
  });
});

describe('proxied tool calls', () => {
  it("sends the call downstream with the caller's abort signal and the server's call timeout", async () => {
    let options: RequestOptions | undefined;
    const fakeClient = {
      callTool: async (_params: unknown, _schema: unknown, opts: RequestOptions) => {
        options = opts;
        return { content: [] };
      },
    };
    const deps: AggregateDeps = {
      ...stubDeps(fakeClient, { callTimeoutMs: (name) => (name === 'alpha' ? 900_000 : 1) }),
      serverNames: () => ['alpha'],
    };
    const { client, close } = await connectAggregate(deps);

    await client.callTool({ name: 'alpha__slow' });
    await close();

    expect(options?.timeout).toBe(900_000);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    // The caller asked for no progress, so none is asked of the downstream.
    expect(options?.onprogress).toBeUndefined();
  });

  it('cancels the downstream call when the caller cancels', async () => {
    let downstream: AbortSignal | undefined;
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fakeClient = {
      callTool: (_params: unknown, _schema: unknown, opts: RequestOptions) =>
        new Promise((_resolve, reject) => {
          downstream = opts.signal;
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          started();
        }),
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    const caller = new AbortController();
    const call = client.callTool({ name: 'slow' }, undefined, { signal: caller.signal });
    await running;
    caller.abort();

    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(downstream?.aborted).toBe(true));
    await close();
  });

  it("relays the downstream's progress to the caller", async () => {
    const fakeClient = {
      callTool: async (_params: unknown, _schema: unknown, opts: RequestOptions) => {
        opts.onprogress?.({ progress: 1, total: 2, message: 'half' });
        opts.onprogress?.({ progress: 2, total: 2 });
        return { content: [{ type: 'text', text: 'done' }] };
      },
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['alpha'] };
    const { client, close } = await connectAggregate(deps);

    const seen: Progress[] = [];
    await client.callTool({ name: 'alpha__slow' }, undefined, { onprogress: (progress) => seen.push(progress) });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    await close();

    expect(seen).toEqual([
      { progress: 1, total: 2, message: 'half' },
      { progress: 2, total: 2 },
    ]);
  });

  it('namespaces the resource links in a tool result on the aggregate, so reading one routes back', async () => {
    let read: string | undefined;
    const fakeClient = {
      callTool: async () => ({
        content: [
          { type: 'text', text: 'wrote two notes' },
          { type: 'resource_link', uri: 'file:///a', name: 'a' },
          { type: 'resource', resource: { uri: 'file:///b', text: 'b' } },
        ],
      }),
      readResource: async (p: { uri: string }) => {
        read = p.uri;
        return { contents: [{ uri: p.uri, text: 'a' }] };
      },
    };
    const deps: AggregateDeps = { ...stubDeps(fakeClient), serverNames: () => ['alpha'] };
    const { client, close } = await connectAggregate(deps);

    const result = await client.callTool({ name: 'alpha__write' });
    const [text, link, embedded] = result.content as Array<Record<string, unknown>>;
    expect(text).toEqual({ type: 'text', text: 'wrote two notes' });
    expect(link).toEqual({ type: 'resource_link', uri: 'alpha__file:///a', name: 'a' });
    expect(embedded).toEqual({ type: 'resource', resource: { uri: 'alpha__file:///b', text: 'b' } });

    await client.readResource({ uri: String(link?.uri) });
    await close();
    expect(read).toBe('file:///a');
  });

  it("leaves resource links alone on the per-server endpoint, whose URIs are the server's own", async () => {
    const fakeClient = {
      callTool: async () => ({ content: [{ type: 'resource_link', uri: 'file:///a', name: 'a' }] }),
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    const result = await client.callTool({ name: 'write' });
    await close();

    expect(result.content).toEqual([{ type: 'resource_link', uri: 'file:///a', name: 'a' }]);
  });
});

describe('logging passthrough', () => {
  it('forwards logging/setLevel on the per-server endpoint', async () => {
    let level: string | undefined;
    const fakeClient = {
      setLoggingLevel: async (l: string) => {
        level = l;
      },
    };
    const { client, close } = await connectProxy(stubDeps(fakeClient));

    await client.setLoggingLevel('debug');
    await close();

    expect(level).toBe('debug');
  });

  it('fans logging/setLevel out to every member on the aggregate', async () => {
    const levels: Record<string, string> = {};
    const deps: AggregateDeps = {
      ...stubDeps(null, {
        withClient: async (name, run) =>
          run({
            setLoggingLevel: async (l: string) => {
              levels[name] = l;
            },
          } as unknown as Client),
      }),
      serverNames: () => ['alpha', 'beta'],
    };
    const { client, close } = await connectAggregate(deps);

    await client.setLoggingLevel('warning');
    await close();

    expect(levels).toEqual({ alpha: 'warning', beta: 'warning' });
  });
});

describe('capabilities', () => {
  it("advertises the downstream's own declared surfaces on a 1:1 endpoint", async () => {
    const server = createProxyServer('demo', stubDeps({}), {
      capabilities: { tools: { listChanged: true } },
    });
    const { client, close } = await connect(server);
    // A tools-only server behind the proxy is a tools-only endpoint in front of it.
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: true } });
    await close();
  });

  it('does not claim subscribe for a downstream that cannot subscribe', () => {
    // The sharp one: claimed unconditionally before, so a client was invited to
    // send a `resources/subscribe` that only the failure would answer.
    expect(proxyCapabilities({ resources: { listChanged: true } })).toEqual({
      resources: { subscribe: false, listChanged: true },
    });
    expect(proxyCapabilities({ resources: { subscribe: true } })).toEqual({
      resources: { subscribe: true, listChanged: false },
    });
  });

  it('answers "no such method" for a surface the downstream does not have', async () => {
    const { client, close } = await connect(createProxyServer('demo', stubDeps({}), { capabilities: { tools: {} } }));
    // Not an empty list: that reads as a server which has resources and happens
    // to have none, which is a different and untrue answer.
    await expect(client.listResources()).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    await close();
  });

  it('advertises everything it can relay for a downstream that has not connected', async () => {
    const { client, close } = await connectProxy(stubDeps({}));
    // Claiming too much costs a client one empty round trip; claiming too little
    // costs it the surface, so an unknown downstream gets the generous answer.
    expect(client.getServerCapabilities()).toEqual({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      logging: {},
      completions: {},
    });
    await close();
  });

  it('keeps the union on the aggregate, whose members are not connected yet', async () => {
    const { client, close } = await connectAggregate({ ...stubDeps({}), serverNames: () => ['git'] });
    expect(client.getServerCapabilities()).toEqual({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      logging: {},
      completions: {},
    });
    await close();
  });
});

describe('instructions', () => {
  it("forwards a single downstream server's instructions unchanged", async () => {
    const server = createProxyServer('demo', stubDeps({}), { instructions: 'Prefer this over a web search.' });
    const { client, close } = await connect(server);
    // Nothing is renamed on the 1:1 endpoint, so there is nothing to rewrite.
    expect(client.getInstructions()).toBe('Prefer this over a web search.');
    await close();
  });

  it('has no instructions when the downstream has none', async () => {
    const { client, close } = await connectProxy(stubDeps({}));
    expect(client.getInstructions()).toBeUndefined();
    await close();
  });

  it('merges the aggregate members under headings, behind a note about the prefix', async () => {
    const merged = mergeInstructions([
      ['context7', 'Use this whenever the user asks about a library.'],
      ['quiet', undefined],
      ['blank', '   '],
      ['git', 'Call `git_status` before staging.'],
    ]);
    // The prefix note has to come first: every name in the sections below is
    // offered to the client with a `<server>__` on the front of it.
    expect(merged).toMatch(/^This endpoint merges several MCP servers\./);
    expect(merged).toContain('`<server>__`');
    expect(merged).toContain('## context7\n\nUse this whenever the user asks about a library.');
    expect(merged).toContain('## git\n\nCall `git_status` before staging.');
    // Servers with nothing to say get no heading at all, rather than an empty one.
    expect(merged).not.toContain('## quiet');
    expect(merged).not.toContain('## blank');
  });

  it('leaves the aggregate without instructions when no member has any', () => {
    expect(mergeInstructions([])).toBeUndefined();
    expect(
      mergeInstructions([
        ['a', undefined],
        ['b', ''],
      ]),
    ).toBeUndefined();
  });

  it('serves the merged instructions on the aggregate endpoint', async () => {
    const deps: AggregateDeps = { ...stubDeps({}), serverNames: () => ['git'] };
    const merged = mergeInstructions([['git', 'Call `git_status` before staging.']]);
    const { client, close } = await connect(createAggregateServer(deps, merged));
    expect(client.getInstructions()).toBe(merged);
    await close();
  });
});
