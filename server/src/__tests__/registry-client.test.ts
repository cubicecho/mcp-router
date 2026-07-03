import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Registry } from '@mcp-router/shared';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../errors.ts';
import { RegistryClient } from '../registry/client.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const listFixture = JSON.parse(readFileSync(path.join(FIXTURES, 'registry-list.json'), 'utf8'));
const detailFixture = JSON.parse(readFileSync(path.join(FIXTURES, 'registry-detail.json'), 'utf8'));

const registry: Registry = { name: 'official', url: 'https://registry.modelcontextprotocol.io' };

function clientReturning(body: unknown, status = 200): { client: RegistryClient; fetchMock: ReturnType<typeof vi.fn> } {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { client: new RegistryClient(fetchMock as unknown as typeof fetch), fetchMock };
}

describe('RegistryClient.listServers', () => {
  it('parses a real /v0/servers response and passes query params', async () => {
    const { client, fetchMock } = clientReturning(listFixture);
    const result = await client.listServers(registry, { search: 'everything', limit: 5, cursor: 'abc' });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/v0/servers');
    expect(url.searchParams.get('version')).toBe('latest');
    expect(url.searchParams.get('search')).toBe('everything');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('cursor')).toBe('abc');

    expect(result.servers.length).toBeGreaterThan(0);
    const first = result.servers[0];
    expect(first?.server.name).toMatch(/\S/);
    expect(first?.server.version).toBeDefined();
  });

  it('normalizes servers: null (empty result set) to an empty array', async () => {
    const { client } = clientReturning({ servers: null, metadata: { count: 0 } });
    const result = await client.listServers(registry);
    expect(result.servers).toEqual([]);
  });

  it('wraps network failures in a friendly 502', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new RegistryClient(fetchMock as unknown as typeof fetch);
    await expect(client.listServers(registry)).rejects.toMatchObject({
      status: 502,
      message: 'Registry "official" is unreachable',
    });
  });

  it('wraps unexpected response shapes in a friendly 502', async () => {
    const { client } = clientReturning({ nope: true });
    await expect(client.listServers(registry)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('unexpected response shape'),
    });
  });

  it('surfaces non-2xx registry responses as 502', async () => {
    const { client } = clientReturning({ error: 'boom' }, 500);
    await expect(client.listServers(registry)).rejects.toMatchObject({ status: 502 });
  });
});

describe('RegistryClient.getServer', () => {
  it('parses a real detail response and URL-encodes the server name', async () => {
    const { client, fetchMock } = clientReturning(detailFixture);
    const entry = await client.getServer(registry, 'io.github.elis132/everything-mcp');

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/v0/servers/io.github.elis132%2Feverything-mcp/versions/latest');
    expect(entry.server.name).toBe('io.github.elis132/everything-mcp');
    expect(entry.server.packages?.length).toBeGreaterThan(0);
  });

  it('maps 404 to a friendly not-found error', async () => {
    const { client } = clientReturning({ title: 'Not Found', status: 404 }, 404);
    await expect(client.getServer(registry, 'nope/nope')).rejects.toMatchObject({
      status: 404,
      message: 'Server "nope/nope" not found in registry "official"',
    });
    await expect(client.getServer(registry, 'nope/nope')).rejects.toBeInstanceOf(HttpError);
  });
});
