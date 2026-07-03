import type { ServerSource } from '@mcp-router/shared';

/** Human-readable one-liner for a server's install source. */
export function formatSource(source: ServerSource): string {
  switch (source.type) {
    case 'registry':
      return `${source.registry}: ${source.serverName}${source.version ? `@${source.version}` : ''}`;
    case 'npm':
      return `npm: ${source.package}@${source.version ?? 'latest'}`;
    case 'remote':
      return 'remote';
  }
}

/** Derive a local server name suggestion from a registry/npm name like "io.github.owner/repo". */
export function suggestLocalName(name: string): string {
  const lastSegment = name.split('/').pop() ?? name;
  return lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
}
