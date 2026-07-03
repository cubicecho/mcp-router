import type { Registry, RegistryListResponse, RegistryServerEntry } from '@mcp-router/shared';
import { registryListResponseSchema, registryServerEntrySchema } from '@mcp-router/shared';
import { errorMessage, HttpError } from '../errors.ts';

export interface RegistrySearchParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Client for MCP-registry-API-compatible services
 * (GET /v0/servers and GET /v0/servers/{name}/versions/latest).
 */
export class RegistryClient {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async listServers(registry: Registry, params: RegistrySearchParams = {}): Promise<RegistryListResponse> {
    const url = new URL('v0/servers', baseUrl(registry));
    url.searchParams.set('version', 'latest');
    if (params.search) {
      url.searchParams.set('search', params.search);
    }
    if (params.cursor) {
      url.searchParams.set('cursor', params.cursor);
    }
    if (params.limit) {
      url.searchParams.set('limit', String(params.limit));
    }
    const body = await this.fetchJson(url, registry);
    // The registry's ServerListResponse allows servers: null for empty result sets.
    if (typeof body === 'object' && body !== null && (body as { servers?: unknown }).servers === null) {
      (body as { servers: unknown }).servers = [];
    }
    return this.parse(registryListResponseSchema.parse.bind(registryListResponseSchema), body, registry);
  }

  /** Fetch the latest version of a single registry entry ({ server, _meta }). */
  async getServer(registry: Registry, serverName: string): Promise<RegistryServerEntry> {
    const url = new URL(`v0/servers/${encodeURIComponent(serverName)}/versions/latest`, baseUrl(registry));
    const body = await this.fetchJson(url, registry, `Server "${serverName}" not found in registry "${registry.name}"`);
    return this.parse(registryServerEntrySchema.parse.bind(registryServerEntrySchema), body, registry);
  }

  private async fetchJson(url: URL, registry: Registry, notFoundMessage?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    } catch (cause) {
      throw new HttpError(502, `Registry "${registry.name}" is unreachable`, errorMessage(cause), { cause });
    }
    if (response.status === 404 && notFoundMessage) {
      throw new HttpError(404, notFoundMessage);
    }
    if (!response.ok) {
      throw new HttpError(
        502,
        `Registry "${registry.name}" responded with HTTP ${response.status}`,
        (await response.text().catch(() => '')).slice(0, 500),
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new HttpError(502, `Registry "${registry.name}" returned invalid JSON`, errorMessage(cause), { cause });
    }
  }

  private parse<T>(parse: (value: unknown) => T, body: unknown, registry: Registry): T {
    try {
      return parse(body);
    } catch (cause) {
      throw new HttpError(
        502,
        `Registry "${registry.name}" returned an unexpected response shape`,
        errorMessage(cause),
        {
          cause,
        },
      );
    }
  }
}

function baseUrl(registry: Registry): string {
  return registry.url.endsWith('/') ? registry.url : `${registry.url}/`;
}
