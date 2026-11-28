import { type ServerSource, SourceType } from '@mcp-router/shared';

/**
 * Describes a server's install source in one line.
 *
 * @param source - Where the server was installed from.
 * @returns E.g. `official: io.github.x/y@1.2.0` or `npm: pkg@latest`; `manual` for a remote.
 */
export function formatSource(source: ServerSource): string {
  switch (source.type) {
    case SourceType.Registry:
      return `${source.registry}: ${source.serverName}${source.version ? `@${source.version}` : ''}`;
    case SourceType.Npm:
      return `npm: ${source.package}@${source.version ?? 'latest'}`;
    case SourceType.Pypi:
      return `pypi: ${source.package}@${source.version ?? 'latest'}`;
    case SourceType.Remote:
      return 'manual';
  }
}
