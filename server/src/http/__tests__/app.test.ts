import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode, serverConfigSchema } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type ClientCapabilities,
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestAuthHost, mintTestKey } from '../../auth/__tests__/test-auth.ts';
import type { AuthHost } from '../../auth/auth-host.ts';
import type { ConfigStore } from '../../config/store.ts';
import { upstreamFailed } from '../../core/errors.ts';
import { SERVER_VERSION } from '../../core/version.ts';
import { createTestDb, createTestStore, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { ECHO_INSTRUCTIONS } from '../../gateway/__tests__/fixtures/echo-instructions.ts';
import { workspaceInstanceKey } from '../../gateway/instance-key.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { createApp } from '../app.ts';

/** Stand a stub in for a server's downstream client, at the one door a resolver sends a request through. */
function stubDownstream(manager: GatewayManager, stub: Partial<Record<keyof Client, unknown>>) {
  vi.spyOn(manager, 'withClient').mockImplementation(async (_name, run) => run(stub as unknown as Client));
}

/** A remote server that is never reached: every test that calls it stubs its downstream client. */
const HOSTED = serverConfigSchema.parse({
  name: 'hosted',
  source: { type: 'remote' },
  transport: { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} },
});

describe('the management API over /graphql', () => {
  let dataDir: string;
  let store: ConfigStore;
  let database: Database;
  let manager: GatewayManager;
  let token: string;
  let authHost: AuthHost;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-app-'));
    await resetTestDb(database);
    store = await createTestStore(database, dataDir);
    authHost = await createTestAuthHost(database.db);
    token = await mintTestKey(database.db, authHost);
    manager = new GatewayManager(() => store.getSettings());
    await manager.reconcile(store.getServers());
    app = createApp({ db: database.db, authHost, store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  /**
   * Posts one operation to /graphql with the token.
   *
   * @param query - The operation.
   * @param [variables] - Its variables.
   * @returns The answer's body: `data`, and `errors` when it was refused.
   */
  const gql = async (query: string, variables?: Record<string, unknown>) =>
    (await authed(request(app).post('/graphql')).send({ query, variables })).body;

  /** Saves `HOSTED` and has the gateway take it in. */
  const addHosted = async () => {
    await store.saveServer(HOSTED);
    await manager.reconcile(store.getServers(), store.getWorkspaces());
  };

  it('requires a credential on /graphql and /mcp, and serves no /api', async () => {
    const anonymous = await request(app).post('/graphql').send({ query: '{ routerStatus { version } }' });
    expect(anonymous.body.errors[0].extensions.code).toBe(ErrorCode.Unauthenticated);
    expect((await request(app).post('/mcp').send({})).status).toBe(401);
    expect((await authed(request(app).get('/api/servers'))).status).toBe(404);
  });

  it('answers /healthz without a token', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: SERVER_VERSION });
  });

  it('reports router status', async () => {
    const { data } = await gql('{ routerStatus { version serverCount runningCount } }');
    expect(data.routerStatus).toEqual({ version: SERVER_VERSION, serverCount: 0, runningCount: 0 });
  });

  it('stops serving a server on /mcp once it is disabled', async () => {
    await addHosted();
    const { errors } = await gql('mutation { updateServer(name: "hosted", input: { enabled: false }) { enabled } }');
    expect(errors).toBeUndefined();
    expect((await authed(request(app).post('/mcp/hosted')).send({})).status).toBe(404);
    expect((await authed(request(app).post('/mcp/nope')).send({})).status).toBe(404);
  });

  it('passes a connect failure and its backoff through with distinct codes', async () => {
    // Written straight to the store: installServer installs, and this one is a hand-written child that only has to fail.
    await store.saveServer(
      serverConfigSchema.parse({
        name: 'boom',
        source: { type: 'npm', package: 'none' },
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: ['-e', "console.error('ModuleNotFoundError: no module named x'); process.exit(1)"],
        },
      }),
    );
    await manager.reconcile(store.getServers());

    // A tried-and-failed connect carries the child's own stderr; the next one, still inside the crash backoff, is
    // UNAVAILABLE. They must not collapse: "try again later" and "it is broken" are different answers.
    const failed = await gql('{ serverTools(name: "boom") { name } }');
    expect(failed.errors[0].extensions.code).toBe(ErrorCode.UpstreamFailed);
    expect(failed.errors[0].extensions.detail).toContain('ModuleNotFoundError: no module named x');

    const backedOff = await gql('{ serverTools(name: "boom") { name } }');
    expect(backedOff.errors[0].extensions.code).toBe(ErrorCode.Unavailable);
    expect(backedOff.errors[0].message).toMatch(/backed off/);
  });

  it('lists resources and prompts from a connected server, and none when it lacks them', async () => {
    await addHosted();
    stubDownstream(manager, {
      listResources: async () => ({ resources: [{ uri: 'file:///a.txt', name: 'A' }] }),
      listResourceTemplates: async () => ({ resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'Files' }] }),
      listPrompts: async () => ({ prompts: [{ name: 'greet', description: 'Say hi' }] }),
    });
    const listed = await gql(`{
      serverResources(name: "hosted") { resources { uri name } resourceTemplates { uriTemplate name } }
      serverPrompts(name: "hosted") { name description }
    }`);
    expect(listed.data).toEqual({
      serverResources: {
        resources: [{ uri: 'file:///a.txt', name: 'A' }],
        resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'Files' }],
      },
      serverPrompts: [{ name: 'greet', description: 'Say hi' }],
    });

    const unsupported = () =>
      Promise.reject(new Error('Server does not support resources (required for resources/list)'));
    stubDownstream(manager, {
      listResources: unsupported,
      listResourceTemplates: unsupported,
      listPrompts: unsupported,
    });
    const empty = await gql(`{
      serverResources(name: "hosted") { resources { uri } resourceTemplates { uriTemplate } }
      serverPrompts(name: "hosted") { name }
    }`);
    expect(empty.data).toEqual({ serverResources: { resources: [], resourceTemplates: [] }, serverPrompts: [] });
  });

  it('reads a resource and gets a prompt for the UI, recording both to activity', async () => {
    await addHosted();
    const readResource = vi.fn(async ({ uri }: { uri: string }) => ({ contents: [{ uri, text: 'hello' }] }));
    const getPrompt = vi.fn(
      async ({ name, arguments: args }: { name: string; arguments?: Record<string, string> }) => ({
        description: `prompt ${name}`,
        messages: [{ role: 'user', content: { type: 'text', text: args?.topic ?? '' } }],
      }),
    );
    stubDownstream(manager, { readResource, getPrompt });

    const read = await gql('mutation { readServerResource(name: "hosted", uri: "file:///a.txt") { contents } }');
    expect(read.data.readServerResource.contents[0]).toMatchObject({ uri: 'file:///a.txt', text: 'hello' });
    expect(readResource).toHaveBeenCalledWith({ uri: 'file:///a.txt' });

    const got = await gql(
      'mutation($args: JSON) { getServerPrompt(name: "hosted", prompt: "greet", arguments: $args) { description messages } }',
      { args: { topic: 'weather' } },
    );
    expect(got.data.getServerPrompt.description).toBe('prompt greet');
    expect(getPrompt).toHaveBeenCalledWith({ name: 'greet', arguments: { topic: 'weather' } });

    // Both UI invocations land in the activity log, newest first.
    const entries = manager.getActivity('hosted');
    expect(entries.map((entry) => entry.method)).toEqual(['prompts/get', 'resources/read']);
    expect(entries.every((entry) => entry.via === 'ui' && entry.ok)).toBe(true);
  });

  it('logs a UI call the manager refused, and one that waited on a connect', async () => {
    await addHosted();

    // A server that would not connect answers with the manager's own code.
    vi.spyOn(manager, 'withClient').mockRejectedValueOnce(
      upstreamFailed('Failed to connect to server "hosted"', 'stderr tail'),
    );
    const refused = await gql('mutation { callServerTool(name: "hosted", tool: "echo") { isError } }');
    expect(refused.errors[0].extensions.code).toBe(ErrorCode.UpstreamFailed);
    expect(manager.getActivity('hosted')).toMatchObject([
      {
        via: 'ui',
        method: 'tools/call',
        target: 'echo',
        ok: false,
        error: 'Failed to connect to server "hosted": stderr tail',
      },
    ]);

    // A cold server spends the start of the request connecting, and that wait is part of the call.
    const callTool = vi.fn(async () => ({ content: [] }));
    vi.spyOn(manager, 'withClient').mockImplementationOnce(async (_key, run) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return run({ callTool } as unknown as Client);
    });
    const slow = await gql('mutation { callServerTool(name: "hosted", tool: "echo") { content isError } }');
    expect(slow.data.callServerTool).toEqual({ content: [], isError: false });
    expect(manager.getActivity('hosted')[0]?.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('gates a workspace endpoint on its being enabled, and moves it with its slug', async () => {
    await addHosted();
    const { data } = await gql('{ servers { id } }');
    const members = [{ serverId: data.servers[0].id }];
    const save = async (input: Record<string, unknown>) =>
      (await gql('mutation($input: SaveWorkspaceInput!) { saveWorkspace(input: $input) { id slug } }', { input })).data
        .saveWorkspace;

    const created = await save({ name: 'Acme Backend', members });
    expect(created.slug).toBe('acme-backend');
    expect((await authed(request(app).post('/mcp/w/acme-backend')).send({})).status).not.toBe(404);

    await save({ id: created.id, name: 'Renamed', slug: 'renamed', members });
    expect(store.getWorkspace('acme-backend')).toBeUndefined();
    expect((await authed(request(app).post('/mcp/w/acme-backend')).send({})).status).toBe(404);

    await save({ id: created.id, name: 'Renamed', slug: 'renamed', enabled: false, members });
    expect((await authed(request(app).post('/mcp/w/renamed')).send({})).status).toBe(404);
    expect(store.getWorkspace('renamed')?.enabled).toBe(false);
  });

  it("runs a workspace's UI calls against the member's own instance, under its exposed name", async () => {
    await addHosted();
    await store.saveWorkspace({ name: 'Team', slug: 'team', enabled: true, members: { hosted: { enabled: true } } });
    await manager.reconcile(store.getServers(), store.getWorkspaces());
    const memberKey = workspaceInstanceKey('team', 'hosted');

    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }));
    const readResource = vi.fn(async () => {
      throw new Error('down');
    });
    const listTools = vi.fn(async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }));
    stubDownstream(manager, { callTool, readResource, listTools });

    // The listing is namespaced, and its count belongs to the member's instance, not the base server.
    const tools = await gql('{ workspaceTools(slug: "team") { name } }');
    expect(tools.data.workspaceTools).toEqual([{ name: 'hosted__echo' }]);
    expect(manager.status(memberKey)?.toolCount).toBe(1);
    expect(manager.status('hosted')?.toolCount).toBeUndefined();

    // A tool that resolves with isError is still an answer, and is logged as a failure with its text.
    const called = await gql(
      'mutation { callWorkspaceTool(slug: "team", tool: "hosted__echo", arguments: { a: 1 }) { content isError } }',
    );
    expect(called.data.callWorkspaceTool).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
    expect(callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { a: 1 } });

    // A downstream that throws is UPSTREAM_FAILED, logged with the thrown message.
    const read = await gql(
      'mutation { readWorkspaceResource(slug: "team", uri: "hosted__file:///a.txt") { contents } }',
    );
    expect(read.errors[0].extensions.code).toBe(ErrorCode.UpstreamFailed);
    expect(readResource).toHaveBeenCalledWith({ uri: 'file:///a.txt' });

    // A name that resolves to no member is the caller's error, and is not logged anywhere.
    const unknown = await gql('mutation { callWorkspaceTool(slug: "team", tool: "ghost__echo") { isError } }');
    expect(unknown.errors[0].extensions.code).toBe(ErrorCode.BadUserInput);

    const activity = await gql('{ workspaceActivity(slug: "team") { via method target ok error } }');
    expect(activity.data.workspaceActivity).toMatchObject([
      { via: 'UI', method: 'resources/read', target: 'file:///a.txt', ok: false, error: 'down' },
      { via: 'UI', method: 'tools/call', target: 'echo', ok: false, error: 'boom' },
    ]);
    expect(manager.getActivity(memberKey)).toHaveLength(2);
    expect(manager.getActivity('hosted')).toEqual([]);
  });
});

describe('the built web UI', () => {
  let dataDir: string;
  let database: Database;
  let manager: GatewayManager;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    database = await createTestDb();
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-spa-'));
    const appDist = path.join(dataDir, 'dist');
    await mkdir(appDist);
    await writeFile(path.join(appDist, 'index.html'), '<!doctype html><title>MCP Router</title>');
    const store = await createTestStore(database, dataDir);
    manager = new GatewayManager(() => store.getSettings());
    const authHost = await createTestAuthHost(database.db);
    app = createApp({ db: database.db, authHost, store, manager, appDistDir: appDist });
  });

  afterAll(async () => {
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    await database.close();
  });

  it("serves the UI's page for its own routes, /api included, and never for a backend path", async () => {
    for (const route of ['/', '/servers/docs', '/api/servers']) {
      const res = await request(app).get(route);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>MCP Router</title>');
    }
    for (const route of ['/graphql', '/admin/mcp', '/mcp', '/mcp/docs', '/oauth/callback']) {
      const res = await request(app).get(route);
      expect(res.text).not.toContain('<title>MCP Router</title>');
    }
  });
});

describe('MCP session lifecycle', () => {
  let dataDir: string;
  let store: ConfigStore;
  let database: Database;
  let manager: GatewayManager;
  let token: string;
  let authHost: AuthHost;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-session-'));
    await resetTestDb(database);
    store = await createTestStore(database, dataDir);
    authHost = await createTestAuthHost(database.db);
    token = await mintTestKey(database.db, authHost);
    manager = new GatewayManager(() => store.getSettings());
    await manager.reconcile(store.getServers());
    app = createApp({ db: database.db, authHost, store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterEach(async () => {
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const asEventStream = (req: request.Test) => req.set('Accept', 'application/json, text/event-stream');

  it('completes a full stateful session over HTTP via a real MCP client', async () => {
    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      // connect() runs the full initialize handshake against a minted session.
      await client.connect(transport);
      expect(transport.sessionId).toBeTruthy();
      // The aggregate advertises the full capability set now.
      expect(client.getServerCapabilities()).toMatchObject({
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        logging: {},
        completions: {},
      });
      // No servers installed → the aggregate lists nothing, over the same session.
      expect((await client.listTools()).tools).toEqual([]);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it("serves a downstream server's own instructions, 1:1 and merged into the aggregate", async () => {
    await store.saveServer(
      serverConfigSchema.parse({
        name: 'echo',
        source: { type: 'npm', package: 'none' },
        transport: {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(import.meta.dirname, '../../gateway/__tests__/fixtures/echo-server.ts')],
        },
      }),
    );
    await manager.reconcile(store.getServers(), store.getWorkspaces());

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    const open = async (endpoint: string) => {
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${endpoint}`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      return client;
    };

    const direct = await open('/mcp/echo');
    const aggregate = await open('/mcp');
    try {
      // /mcp/echo connects the child during its own initialize, so the very first
      // session on a cold router already carries the server's guidance.
      expect(direct.getInstructions()).toBe(ECHO_INSTRUCTIONS);

      // The aggregate reads what has already been said rather than spawning every
      // member to ask — which the session above is what made available.
      expect(aggregate.getInstructions()).toContain('## echo');
      expect(aggregate.getInstructions()).toContain(ECHO_INSTRUCTIONS);
      // ...along with the one thing no member can know: its names are prefixed here.
      expect(aggregate.getInstructions()).toContain('`<server>__`');

      // The same connect settles what this endpoint declares. The fixture serves
      // tools and nothing else, so a client is not invited to ask it for resources
      // or to subscribe to them.
      expect(direct.getServerCapabilities()).toEqual({ tools: { listChanged: true } });
      // The aggregate has not connected anything to ask, so it keeps the union of
      // what any member might support.
      expect(aggregate.getServerCapabilities()).toMatchObject({
        resources: { subscribe: true, listChanged: true },
      });
    } finally {
      await Promise.all([direct.close(), aggregate.close()]);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  describe('relaying a downstream through the aggregate', () => {
    let httpServer: ReturnType<typeof createServer>;
    let port: number;

    beforeEach(async () => {
      await store.saveServer(
        serverConfigSchema.parse({
          name: 'relay',
          source: { type: 'npm', package: 'none' },
          transport: {
            type: 'stdio',
            command: process.execPath,
            args: [path.join(import.meta.dirname, '../../gateway/__tests__/fixtures/relay-server.ts')],
          },
        }),
      );
      await manager.reconcile(store.getServers(), store.getWorkspaces());
      httpServer = createServer(app);
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      port = (httpServer.address() as AddressInfo).port;
    });

    afterEach(async () => {
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const open = async (capabilities: ClientCapabilities = {}, fetchVia?: FetchLike) => {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: fetchVia,
      });
      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities });
      await client.connect(transport);
      return { client, transport };
    };

    /**
     * Waits until the session's GET stream is open, by asking for progress until some arrives: what the router relays
     * goes out on that stream, and is lost when it is not there yet.
     *
     * @remarks
     * One report is proof enough, and waiting for both is a race: the result comes back on the call's own POST, so on
     * a loaded machine it can beat the second report in, and the client stops listening for progress at the result.
     */
    const streamOpen = (client: Client) =>
      vi.waitFor(
        async () => {
          const seen: number[] = [];
          await client.callTool({ name: 'relay__progress', arguments: {} }, undefined, {
            onprogress: ({ progress }) => seen.push(progress),
          });
          expect(seen.length).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );

    /** The one text block a relay tool answers with, parsed. */
    const answerOf = (result: Awaited<ReturnType<Client['callTool']>>): unknown => {
      const [block] = result.content as Array<{ text: string }>;
      return JSON.parse(block?.text ?? 'null');
    };

    /** What the downstream's one connection is subscribed to, asked of the child itself. */
    const subscriptions = async (client: Client): Promise<string[]> => {
      const result = await client.callTool({ name: 'relay__subscriptions', arguments: {} });
      const [block] = result.content as Array<{ text: string }>;
      return JSON.parse(block?.text ?? '[]');
    };

    it("relays the downstream's progress to the caller, under the caller's token", async () => {
      const { client } = await open();
      try {
        // Asked again until the session's GET stream, which progress arrives on, is open: progress sent
        // before a client's GET lands is dropped, as any relayed notification is. What does arrive is the
        // downstream's reports in order, though the last can trail the result in (see `streamOpen`).
        await vi.waitFor(
          async () => {
            const seen: number[] = [];
            const result = await client.callTool({ name: 'relay__progress', arguments: {} }, undefined, {
              onprogress: ({ progress }) => seen.push(progress),
            });
            expect(result.content).toEqual([{ type: 'text', text: 'done' }]);
            expect(seen.length).toBeGreaterThan(0);
            expect(seen).toEqual([1, 2].slice(0, seen.length));
          },
          { timeout: 10_000 },
        );
      } finally {
        await client.close();
      }
    });

    it("puts a downstream's question to the session whose call asked it, and hands its answer back", async () => {
      const { client } = await open({ elicitation: {} });
      const asked: string[] = [];
      client.setRequestHandler(ElicitRequestSchema, async (req) => {
        asked.push(req.params.message);
        return { action: 'accept', content: { name: 'tester' } };
      });
      try {
        // Straight after connect, with no wait for the GET stream the question goes out on: a question that
        // gets there first is held for it.
        const result = await client.callTool({ name: 'relay__ask', arguments: {} });
        expect(answerOf(result)).toEqual({ action: 'accept', content: { name: 'tester' } });
        expect(asked).toEqual(['Who is asking?']);
      } finally {
        await client.close();
      }
    });

    it("holds a downstream's question back until the asking session's GET stream is open", async () => {
      // The client's GET is kept from the router until the call is well under way, so the question is asked while
      // the session has no stream to put it on — the order a slow network or a loaded machine gives a client whose
      // first call races its stream. Dropped, it would leave the call waiting out its timeout.
      let releaseStream = () => {};
      const held = new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      const holdingGet: FetchLike = async (url, init) => {
        if (init?.method === 'GET') {
          await held;
        }
        return fetch(url, init);
      };
      const { client } = await open({ elicitation: {} }, holdingGet);
      client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { name: 'tester' } }));
      try {
        const call = client.callTool({ name: 'relay__ask', arguments: {} });
        await new Promise((resolve) => setTimeout(resolve, 200));
        releaseStream();
        expect(answerOf(await call)).toEqual({ action: 'accept', content: { name: 'tester' } });
      } finally {
        releaseStream();
        await client.close();
      }
    });

    it("declines a downstream's question for a session whose client cannot answer one", async () => {
      const { client } = await open();
      try {
        const result = await client.callTool({ name: 'relay__ask', arguments: {} });
        expect(answerOf(result)).toEqual({ action: 'decline' });
      } finally {
        await client.close();
      }
    });

    it("relays a downstream's log line to the session whose call caused it, and to no other", async () => {
      const first = await open();
      const second = await open();
      const heard: Record<'first' | 'second', unknown[]> = { first: [], second: [] };
      first.client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
        heard.first.push(n.params.data);
      });
      second.client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
        heard.second.push(n.params.data);
      });
      try {
        // Both streams open, so a line sent to every session would reach the second as surely as the first.
        await streamOpen(first.client);
        await streamOpen(second.client);
        await first.client.callTool({ name: 'relay__log', arguments: {} });
        await vi.waitFor(() => expect(heard.first).toEqual(['working']));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(heard.second).toEqual([]);
      } finally {
        await Promise.all([first.client.close(), second.client.close()]);
      }
    });

    it('hands out resource links the aggregate can read back', async () => {
      const { client } = await open();
      try {
        const result = await client.callTool({ name: 'relay__link', arguments: {} });
        expect(result.content).toEqual([{ type: 'resource_link', uri: 'relay__relay://note', name: 'note' }]);
        const read = await client.readResource({ uri: 'relay__relay://note' });
        expect(read.contents).toEqual([{ uri: 'relay://note', text: 'hello' }]);
      } finally {
        await client.close();
      }
    });

    it("keeps one session's subscription when another unsubscribes, and ends it when the last one closes", async () => {
      const first = await open();
      const second = await open();
      try {
        await first.client.subscribeResource({ uri: 'relay__relay://note' });
        await second.client.subscribeResource({ uri: 'relay__relay://note' });
        await first.client.unsubscribeResource({ uri: 'relay__relay://note' });
        expect(await subscriptions(first.client)).toEqual(['relay://note']);

        // Ending the session is letting go: the downstream is told once nobody is left.
        await second.transport.terminateSession();
        await vi.waitFor(async () => expect(await subscriptions(first.client)).toEqual([]));
      } finally {
        await Promise.all([first.client.close(), second.client.close()]);
      }
    });
  });

  it('rejects a non-initialize request that carries no session id', async () => {
    const res = await asEventStream(authed(request(app).post('/mcp'))).send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(res.status).toBe(400);
  });

  it('404s a request bearing an unknown or expired session id', async () => {
    const res = await asEventStream(authed(request(app).post('/mcp')))
      .set('mcp-session-id', 'does-not-exist')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(404);
  });

  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
  };

  /** Mint a session over HTTP and return its id from the response header. */
  const initSession = async (): Promise<string> => {
    const res = await asEventStream(authed(request(app).post('/mcp'))).send(initBody);
    expect(res.status).toBe(200);
    const id = res.headers['mcp-session-id'];
    expect(id).toBeTruthy();
    return id as string;
  };

  /** A follow-up call on a session; 200 while live, 404 once the router has reclaimed it. */
  const listWithSession = (id: string) =>
    asEventStream(authed(request(app).post('/mcp')))
      .set('mcp-session-id', id)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

  it('picks up a workspace member added after the session was initialized', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Unreachable on purpose: the fan-out can't connect, and records that failure
    // under the member's workspace instance — which is the observable proving the
    // member was in the session's member set at all.
    await store.saveServer({
      name: 'unreachable',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} },
      enabled: true,
      env: {},
      envMeta: {},
    });
    await store.saveWorkspace({ name: 'Later', slug: 'later', enabled: true, members: {} });
    await manager.reconcile(store.getServers(), store.getWorkspaces());

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/w/later`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toEqual([]);
      expect(manager.getActivity(workspaceInstanceKey('later', 'unreachable'))).toEqual([]);

      // Add the member mid-session, as an edit through the UI or the config file would.
      await store.saveWorkspace({
        name: 'Later',
        slug: 'later',
        enabled: true,
        members: { unreachable: { enabled: true } },
      });
      await manager.reconcile(store.getServers(), store.getWorkspaces());

      expect((await client.listTools()).tools).toEqual([]);
      expect(manager.getActivity(workspaceInstanceKey('later', 'unreachable'))).toMatchObject([
        { method: 'tools/list', via: 'aggregate', ok: false },
      ]);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('reclaims a session left idle past the configured TTL', async () => {
    await store.updateSettings({ sessionIdleTimeoutMs: 60_000 });
    // Freeze only Date (not timers, so supertest's async still runs) to drive idleness deterministically.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const id = await initSession();
      expect((await listWithSession(id)).status).toBe(200);
      // Jump past the TTL; the next request's opportunistic sweep reclaims the idle session.
      vi.setSystemTime(Date.now() + 61_000);
      expect((await listWithSession(id)).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a session whose client is holding its SSE stream open, however long since it last called', async () => {
    await store.updateSettings({ sessionIdleTimeoutMs: 60_000 });
    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    const stream = new AbortController();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const id = await initSession();
      // What an SDK client does right after initialize, and holds for the life of the connection.
      const sse = await fetch(`http://127.0.0.1:${port}/mcp`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', 'mcp-session-id': id },
        signal: stream.signal,
      });
      expect(sse.status).toBe(200);

      // A long lull between tool calls, with the stream still open: the client is still here.
      vi.setSystemTime(Date.now() + 61_000);
      expect((await listWithSession(id)).status).toBe(200);

      // Once the client stops listening, the TTL runs from then.
      stream.abort();
      await vi.waitFor(async () => {
        vi.setSystemTime(Date.now() + 61_000);
        expect((await listWithSession(id)).status).toBe(404);
      });
    } finally {
      vi.useRealTimers();
      stream.abort();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('evicts the least-recently-active session when the cap is reached', async () => {
    await store.updateSettings({ maxSessions: 1 });
    const first = await initSession();
    // Initializing a second session while at the cap evicts the first.
    const second = await initSession();
    expect((await listWithSession(first)).status).toBe(404);
    expect((await listWithSession(second)).status).toBe(200);
  });

  it("relays a downstream notification only to the endpoints that expose its instance, under that endpoint's names", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveServer({
      name: 'alpha',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} },
      enabled: true,
      env: {},
      envMeta: {},
    });
    await store.saveWorkspace({ name: 'Team', slug: 'team', enabled: true, members: { alpha: { enabled: true } } });
    await manager.reconcile(store.getServers(), store.getWorkspaces());

    // Stand in for the pool: every session subscribes, and every session hears every instance.
    const listeners: Parameters<GatewayManager['onNotification']>[0][] = [];
    vi.spyOn(manager, 'onNotification').mockImplementation((listener) => {
      listeners.push(listener);
      return () => {};
    });
    const emit = (key: string, uri: string) => {
      for (const listener of listeners) {
        listener(key, { method: 'notifications/resources/updated', params: { uri } });
      }
    };

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;
    const clients: Client[] = [];
    const connect = async (endpoint: string): Promise<Set<unknown>> => {
      const uris = new Set<unknown>();
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      client.fallbackNotificationHandler = async (notification) => {
        uris.add(notification.params?.uri);
      };
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${endpoint}`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      return uris;
    };
    try {
      const aggregate = await connect('/mcp');
      const workspace = await connect('/mcp/w/team');
      const direct = await connect('/mcp/alpha');

      // Re-emitted until each stream is open: a notification sent before a client's GET lands is dropped.
      await vi.waitFor(() => {
        emit('alpha', 'file:///base');
        emit(workspaceInstanceKey('team', 'alpha'), 'file:///member');
        expect(aggregate.size).toBeGreaterThan(0);
        expect(workspace.size).toBeGreaterThan(0);
        expect(direct.size).toBeGreaterThan(0);
      });

      expect([...aggregate]).toEqual(['alpha__file:///base']);
      expect([...workspace]).toEqual(['alpha__file:///member']);
      expect([...direct]).toEqual(['file:///base']);
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});
