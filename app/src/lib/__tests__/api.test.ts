import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getStatus, listServers, updateServer } from '@/lib/api';
import { getNeedsAuth, setToken, TOKEN_STORAGE_KEY } from '@/lib/auth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.clear();
    // reset the needsAuth flag from previous tests
    setToken('reset');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('attaches the bearer token from localStorage', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'secret-token');
    fetchMock.mockResolvedValue(
      jsonResponse(200, { version: '1', uptimeSeconds: 1, serverCount: 0, runningCount: 0, authEnabled: true }),
    );

    await getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      }),
    );
  });

  it('sends no Authorization header without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await listServers();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('flags needsAuth and throws an ApiRequestError on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));

    await expect(getStatus()).rejects.toMatchObject({ status: 401, message: 'unauthorized' });
    expect(getNeedsAuth()).toBe(true);

    // entering a token clears the flag again
    setToken('new-token');
    expect(getNeedsAuth()).toBe(false);
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('new-token');
  });

  it('parses the { error, detail } envelope into a typed error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid name', detail: 'must be lowercase' }));

    const promise = updateServer('bad name', { enabled: true });
    await expect(promise).rejects.toBeInstanceOf(ApiRequestError);
    await promise.catch((error: ApiRequestError) => {
      expect(error.status).toBe(400);
      expect(error.message).toBe('invalid name');
      expect(error.detail).toBe('must be lowercase');
    });
  });

  it('falls back to the status text for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));

    await expect(getStatus()).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' });
  });

  it('sends JSON bodies with the content-type header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { config: { name: 'a' }, state: 'stopped' }));

    await updateServer('a', { env: { FOO: 'bar' } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/servers/a');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ env: { FOO: 'bar' } });
  });
});
