import type { ServerSource } from '@mcp-router/shared';

/** Human-readable one-liner for a server's install source. */
export function formatSource(source: ServerSource): string {
  switch (source.type) {
    case 'registry':
      return `${source.registry}: ${source.serverName}${source.version ? `@${source.version}` : ''}`;
    case 'npm':
      return `npm: ${source.package}@${source.version ?? 'latest'}`;
    case 'pypi':
      return `pypi: ${source.package}@${source.version ?? 'latest'}`;
    case 'remote':
      return 'manual';
  }
}

/** Compact "how long ago" text for an ISO timestamp, e.g. "just now", "5m ago", "2h ago". */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
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

/** A timestamp in the viewer's locale, or the raw text when it does not parse. */
export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Compact uptime, e.g. "3h 12m" or "4m 7s". */
export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}
