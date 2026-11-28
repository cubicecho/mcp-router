import { ErrorCode } from '@mcp-router/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  callTool,
  createApiKey,
  deleteServer,
  getServer,
  getStatus,
  isCallerError,
  listServers,
  updateServer,
  verifyOneTimeToken,
} from '@/lib/api';
import { keepSession, SESSION_STORAGE_KEY, sessionToken } from '@/lib/session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const routerStatus = {
  version: '1',
  uptimeSeconds: 1,
  serverCount: 0,
  runningCount: 0,
  idleTimeoutMs: 300_000,
  publicUrl: null,
  instanceId: 'nas',
  lanAdvertise: false,
  lanDiscovery: true,
};

const serverRow = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'a',
  displayName: null,
  description: null,
  enabled: true,
  source: { type: 'remote' },
  transport: { type: 'streamable-http', url: 'http://localhost:8080/mcp' },
  env: {},
  envMeta: {},
  idleTimeoutMs: null,
  callTimeoutMs: null,
  discovered: null,
};

const runtime = {
  name: 'a',
  state: 'RUNNING',
  pid: null,
  startedAt: null,
  lastError: null,
  toolCount: 2,
  callCount: null,
  lastCalledAt: null,
  oauth: null,
};

/** The JSON body of the nth request sent. */
function sentBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, call = 0): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('posts the operation to /graphql with the session as a bearer token', async () => {
    keepSession('secret-token');
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { routerStatus } }));

    await expect(getStatus()).resolves.toEqual(routerStatus);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' });
    const body = sentBody(fetchMock);
    expect(body.operationName).toBe('RouterStatus');
    expect(body.query).toContain('routerStatus');
  });

  it('sends no Authorization header while signed out', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { servers: [], serverRuntimes: [] } }));

    await listServers();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('pairs each server row with its runtime, and reads a missing runtime as stopped', async () => {
    const other = { ...serverRow, id: '00000000-0000-4000-8000-000000000002', name: 'b' };
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { servers: [serverRow, other], serverRuntimes: [runtime] } }),
    );

    const [a, b] = await listServers();

    expect(a).toMatchObject({ id: serverRow.id, config: { name: 'a', env: {} }, state: 'RUNNING', toolCount: 2 });
    expect(a?.config).not.toHaveProperty('displayName');
    expect(b).toMatchObject({ config: { name: 'b' }, state: 'STOPPED', toolCount: null });
  });

  it('answers null for a server that does not exist', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { server: null, serverRuntimes: [] } }));

    await expect(getServer('missing')).resolves.toBeNull();
    expect(sentBody(fetchMock).variables).toMatchObject({ name: 'missing' });
  });

  it('drops the session and throws an ApiRequestError on 401', async () => {
    keepSession('expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized', code: ErrorCode.Unauthenticated }));

    await expect(getStatus()).rejects.toMatchObject({ status: 401, message: 'unauthorized' });
    expect(sessionToken()).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('drops the session on an UNAUTHENTICATED GraphQL error', async () => {
    keepSession('expired');
    fetchMock.mockResolvedValue(
      jsonResponse(200, { errors: [{ message: 'Sign in first.', extensions: { code: ErrorCode.Unauthenticated } }] }),
    );

    await expect(getStatus()).rejects.toMatchObject({ code: ErrorCode.Unauthenticated });
    expect(sessionToken()).toBeNull();
  });

  it('keeps the session on any other error', async () => {
    keepSession('fine');
    fetchMock.mockResolvedValue(
      jsonResponse(200, { errors: [{ message: 'No.', extensions: { code: ErrorCode.Forbidden } }] }),
    );

    await expect(getStatus()).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    expect(sessionToken()).toBe('fine');
  });

  it('sends the one-time token and answers the session it is spent for', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { verifyOneTimeToken: { token: 'session-1', userId: 'u1' } } }),
    );

    await expect(verifyOneTimeToken('ott')).resolves.toBe('session-1');
    expect(sentBody(fetchMock)).toMatchObject({ operationName: 'VerifyOneTimeToken', variables: { token: 'ott' } });
  });

  it('answers the new API key with its secret', async () => {
    const apiKey = {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'ci',
      start: 'mcpr_ab',
      createdAt: '2026-11-01T00:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { createApiKey: { apiKey, key: 'mcpr_secret' } } }));

    await expect(createApiKey('ci')).resolves.toEqual({ apiKey, key: 'mcpr_secret' });
    expect(sentBody(fetchMock)).toMatchObject({ operationName: 'CreateApiKey', variables: { name: 'ci' } });
  });

  it('reads the first GraphQL error into a typed error, with its code and detail', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: null,
        errors: [
          { message: 'invalid name', extensions: { code: ErrorCode.BadUserInput, detail: 'must be lowercase' } },
        ],
      }),
    );

    const promise = updateServer('bad name', { enabled: true });
    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    await promise.catch((error: ApiRequestError) => {
      expect(error.status).toBe(200);
      expect(error.message).toBe('invalid name');
      expect(error.code).toBe(ErrorCode.BadUserInput);
      expect(error.detail).toBe('must be lowercase');
      expect(isCallerError(error)).toBe(true);
    });
  });

  it('treats an uncoded or upstream failure as worth retrying', () => {
    expect(isCallerError(new ApiRequestError(200, 'boom'))).toBe(false);
    expect(isCallerError(new ApiRequestError(200, 'down', { code: ErrorCode.UpstreamFailed }))).toBe(false);
    expect(isCallerError(new ApiRequestError(404, 'gone'))).toBe(true);
  });

  it('falls back to the status text for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));

    await expect(getStatus()).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' });
  });

  it('sends the name and the changes as variables', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { updateServer: serverRow } }));

    await updateServer('a', { env: { FOO: 'bar' } });

    const body = sentBody(fetchMock);
    expect(body.operationName).toBe('UpdateServer');
    expect(body.variables).toEqual({ name: 'a', input: { env: { FOO: 'bar' } } });
  });

  it('rejects a server row whose config does not have the shape the shared schema promises', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { updateServer: { ...serverRow, transport: { type: 'carrier-pigeon' } } } }),
    );

    await expect(updateServer('a', { enabled: true })).rejects.toThrow();
  });

  it('resolves with nothing once a server is deleted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { deleteServer: { id: serverRow.id } } }));

    await expect(deleteServer('a')).resolves.toBeUndefined();
  });

  it("calls a server's tool through callServerTool, and a workspace's through callWorkspaceTool", async () => {
    const result = { content: [{ type: 'text', text: 'hi' }], structuredContent: null, isError: false };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { callServerTool: result } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { callWorkspaceTool: result } }));

    await expect(callTool({ kind: 'server', name: 'a' }, { name: 'echo', arguments: { x: 1 } })).resolves.toEqual(
      result,
    );
    await expect(callTool({ kind: 'workspace', slug: 'w' }, { name: 'a__echo', arguments: {} })).resolves.toEqual(
      result,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/graphql');
    expect(sentBody(fetchMock)).toMatchObject({
      operationName: 'CallServerTool',
      variables: { name: 'a', tool: 'echo', arguments: { x: 1 } },
    });
    expect(sentBody(fetchMock, 1)).toMatchObject({
      operationName: 'CallWorkspaceTool',
      variables: { slug: 'w', tool: 'a__echo', arguments: {} },
    });
  });
});
