import { type CapabilityScope, SCOPE_SERVER } from './api.ts';

/** Path of the aggregate endpoint that merges every enabled server. */
export const AGGREGATE_ENDPOINT_PATH = '/mcp';

/** Path of the MCP endpoint a server or workspace is served at. */
export function endpointPath(scope: CapabilityScope): string {
  return scope.kind === SCOPE_SERVER ? `/mcp/${scope.name}` : `/mcp/w/${scope.slug}`;
}

/** Absolute URL of an MCP endpoint path on this router, as a client needs it. */
export function endpointUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
