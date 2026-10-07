import {
  HttpStatus,
  type Registry,
  type RegistryListResponse,
  type RegistrySearchParams,
  type RegistryServerEntry,
  registryListResponseSchema,
  registryServerEntrySchema,
} from '@mcp-router/shared';
import { REGISTRY_DEFAULTS } from '../core/defaults.ts';
import { errorMessage, notFound, upstreamFailed, upstreamTimeout } from '../core/errors.ts';
import { isRecord } from '../core/is-record.ts';

/** Client for MCP-registry-API-compatible services (GET /v0/servers and GET /v0/servers/{name}/versions/latest). */
export class RegistryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /**
   * Builds a client over one fetch implementation.
   *
   * @param [fetchImpl] - The fetch to use; tests pass a fake.
   * @param [timeoutMs] - How long a registry may take to answer, in ms.
   */
  constructor(fetchImpl: typeof fetch = fetch, timeoutMs: number = REGISTRY_DEFAULTS.fetchTimeoutMs) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Fetch one page of a registry's servers, latest versions only.
   *
   * @param registry - The registry to ask.
   * @param [params] - Search text, cursor and page size; an empty or zero one is not sent.
   * @returns The page, with a null `servers` read as empty. Throws as `fetchJson` does, or a 502 on a wrong shape.
   */
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

  /**
   * Fetch the latest version of a single registry entry ({ server, _meta }).
   *
   * @param registry - The registry to ask.
   * @param serverName - The entry's full name, slashes included; it is URL-encoded here.
   * @returns The entry. Throws a 404 when the registry has none by that name, or a 502 on a wrong shape.
   */
  async getServer(registry: Registry, serverName: string): Promise<RegistryServerEntry> {
    const url = new URL(`v0/servers/${encodeURIComponent(serverName)}/versions/latest`, baseUrl(registry));
    const body = await this.fetchJson(url, registry, `Server "${serverName}" not found in registry "${registry.name}"`);
    return this.parse(registryServerEntrySchema.parse.bind(registryServerEntrySchema), body, registry);
  }

  /**
   * GETs a registry URL and reads the JSON body.
   *
   * @param url - The URL to fetch.
   * @param registry - Named in the errors.
   * @param [notFoundMessage] - Turns a 404 answer into a 404 with this message; without it a 404 is a 502.
   * @returns The parsed body. Throws a 504 on a timeout, and a 502 when unreachable, not 2xx or not JSON.
   */
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

  /**
   * Validates a registry's response body.
   *
   * @typeParam T - The validated shape.
   * @param parse - Validates the body; throws to reject it.
   * @param body - The parsed JSON.
   * @param registry - Named in the error.
   * @returns The validated body. Throws a 502 when it does not have the expected shape.
   */
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

/**
 * Makes a registry's URL safe to resolve relative paths against.
 *
 * @param registry - The registry.
 * @returns Its URL, ending in a slash.
 */
function baseUrl(registry: Registry): string {
  return registry.url.endsWith('/') ? registry.url : `${registry.url}/`;
}
