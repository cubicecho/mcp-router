import { type CapabilityScope, SCOPE_SERVER } from './api.ts';

/** Path of the aggregate endpoint that merges every enabled server. */
export const AGGREGATE_ENDPOINT_PATH = '/mcp';

/**
 * Gives the path of the MCP endpoint a server or workspace is served at.
 *
 * @param scope - The server or workspace.
 * @returns `/mcp/:name` or `/mcp/w/:slug`, the name or slug not URL-encoded.
 */
export function endpointPath(scope: CapabilityScope): string {
  return scope.kind === SCOPE_SERVER ? `/mcp/${scope.name}` : `/mcp/w/${scope.slug}`;
}

/**
 * Makes an MCP endpoint path absolute on this router, as a client needs it.
 *
 * @param path - Path starting with `/`.
 * @returns The path prefixed with the page's origin.
 */
export function endpointUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
