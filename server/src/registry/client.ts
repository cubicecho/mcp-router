import {
  HttpStatus,
  type Registry,
  type RegistryListResponse,
  type RegistrySearchParams,
  type RegistryServerEntry,
  registryListResponseSchema,
  registryServerEntrySchema,
} from '@mcp-router/shared';
import { REGISTRY_DEFAULTS } from '../defaults.ts';
import { errorMessage, notFound, upstreamFailed, upstreamTimeout } from '../errors.ts';
import { isRecord } from '../is-record.ts';

/**
 * Client for MCP-registry-API-compatible services
 * (GET /v0/servers and GET /v0/servers/{name}/versions/latest).
 */
export class RegistryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /**
   * @param fetchImpl - The fetch to use; tests pass a fake.
   * @param timeoutMs - How long a registry may take to answer, in ms.
   */
  constructor(fetchImpl: typeof fetch = fetch, timeoutMs: number = REGISTRY_DEFAULTS.fetchTimeoutMs) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
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
    if (isRecord(body) && body.servers === null) {
      body.servers = [];
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
      response = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      if (timedOut) {
        throw upstreamTimeout(`Registry "${registry.name}" did not answer within ${this.timeoutMs} ms`, undefined, {
          cause,
        });
      }
      throw upstreamFailed(`Registry "${registry.name}" is unreachable`, errorMessage(cause), {
        cause,
      });
    }
    if (response.status === HttpStatus.NotFound && notFoundMessage) {
      throw notFound(notFoundMessage);
    }
    const requestFailed = response.ok === false;
    if (requestFailed) {
      throw upstreamFailed(
        `Registry "${registry.name}" responded with HTTP ${response.status}`,
        (await response.text().catch(() => '')).slice(0, REGISTRY_DEFAULTS.errorBodyMaxChars),
      );
    }
    try {
      return await response.json();
    } catch (cause) {
      throw upstreamFailed(`Registry "${registry.name}" returned invalid JSON`, errorMessage(cause), { cause });
    }
  }

  private parse<T>(parse: (value: unknown) => T, body: unknown, registry: Registry): T {
    try {
      return parse(body);
    } catch (cause) {
      throw upstreamFailed(`Registry "${registry.name}" returned an unexpected response shape`, errorMessage(cause), {
        cause,
      });
    }
  }
}

function baseUrl(registry: Registry): string {
  return registry.url.endsWith('/') ? registry.url : `${registry.url}/`;
}
