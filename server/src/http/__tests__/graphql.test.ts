import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErrorCode, HttpStatus } from '@mcp-router/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConfigStore } from '../../config/store.ts';
import { MCP_DEFAULTS, OPERATION_LIMIT_DEFAULTS } from '../../core/defaults.ts';
import { createTestDb, createTestStore } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { reconcileOnChange } from '../../gateway/reconcile.ts';
import { ADMIN_TOOLS } from '../../graphql/admin-mcp.ts';
import { ADMIN_MCP_PATH, createApp } from '../app.ts';

const { maxDepth, maxAliases, maxPageSize } = OPERATION_LIMIT_DEFAULTS;

describe('/graphql and /admin/mcp', () => {
  let database: Database;
  let dataDir: string;
  let store: ConfigStore;
  let manager: GatewayManager;
  let token: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    delete process.env.MCP_ROUTER_TOKEN;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    database = await createTestDb();
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-graphql-http-'));
    store = await createTestStore(database, dataDir);
    token = store.getSettings().authToken ?? '';
    manager = new GatewayManager(() => store.getSettings());
    reconcileOnChange({ store, manager });
    app = createApp({ db: database.db, store, manager, appDistDir: path.join(dataDir, 'no-such-dist') });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await manager.stopAll();
    await rm(dataDir, { recursive: true, force: true });
    await database.close();
  });

  const post = (query: string) => request(app).post('/graphql').set('Authorization', `Bearer ${token}`).send({ query });

  it('requires the bearer token on both doors', async () => {
    expect((await request(app).post('/graphql').send({ query: '{ __typename }' })).status).toBe(
      HttpStatus.Unauthorized,
    );
    expect((await request(app).post(ADMIN_MCP_PATH).send({})).status).toBe(HttpStatus.Unauthorized);
  });

  it('answers a query with the token', async () => {
    const res = await post('{ routerStatus { serverCount } }');
    expect(res.body).toEqual({ data: { routerStatus: { serverCount: 0 } } });
  });

  it('refuses a query deeper than maxDepth before running it', async () => {
    // Each level adds two to the depth, so maxDepth levels is well past the bound.
    const nest = (levels: number): string => (levels === 0 ? 'id' : `members { workspace { ${nest(levels - 1)} } }`);
    const res = await post(`{ workspaces { ${nest(maxDepth)} } }`);
    expect(res.body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
    expect(res.body.data).toBeUndefined();
  });

  it('refuses a query with more aliases than maxAliases', async () => {
    const aliases = Array.from({ length: maxAliases + 1 }, (_, index) => `a${index}: routerStatus { version }`);
    const res = await post(`{ ${aliases.join(' ')} }`);
    expect(res.body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
  });

  it('refuses a query whose cost is over maxCost', async () => {
    // A full page of workspaces times a full page of members each is far past maxCost.
    const res = await post(`{ workspaces(limit: ${maxPageSize}) { members(limit: ${maxPageSize}) { id } } }`);
    expect(res.body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
  });

  it('prices a hand-written list at the page it asks for', async () => {
    // Eight fields a row: one full page fits under maxCost, three do not.
    const page = (alias: string) =>
      `${alias}: serverRuntimes(limit: ${maxPageSize}) { name state lastError pid toolCount callCount startedAt lastCalledAt }`;
    const one = await post(`{ ${page('a')} }`);
    expect(one.body.errors).toBeUndefined();
    const three = await post(`{ ${page('a')} ${page('b')} ${page('c')} }`);
    expect(three.body.errors[0].extensions.code).toBe(ErrorCode.QueryTooComplex);
  });

  it('refuses a page larger than maxPageSize', async () => {
    const res = await post(`{ servers(limit: ${maxPageSize + 1}) { id } }`);
    expect(res.body.errors[0].extensions.code).toBe('DRIZZLE_LIMIT_EXCEEDED');
  });

  describe('over MCP', () => {
    let httpServer: Server;
    let client: Client;

    beforeAll(async () => {
      httpServer = createServer(app);
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      const { port } = httpServer.address() as AddressInfo;
      client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${ADMIN_MCP_PATH}`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
    });

    afterAll(async () => {
      await client.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    it('offers the listed tools, within the size budgets', async () => {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(ADMIN_TOOLS.length);
      expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(MCP_DEFAULTS.maxToolListBytes);
      const largest = Math.max(...tools.map((tool) => JSON.stringify(tool).length));
      expect(largest).toBeLessThanOrEqual(MCP_DEFAULTS.maxToolSchemaBytes);
    });

    it("calls a tool with the operator's context", async () => {
      const result = await client.callTool({ name: 'router_status', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain('serverCount');
    });
  });
});
