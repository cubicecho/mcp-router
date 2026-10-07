import { MS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, type ServerSource, SourceType } from '@mcp-router/shared';
import { DISPLAY_DEFAULTS } from './defaults.ts';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** Human-readable one-liner for a server's install source. */
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

/** Compact "how long ago" text for an ISO timestamp, e.g. "just now", "5m ago", "2h ago". */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const seconds = Math.max(0, Math.floor((now - then) / MS_PER_SECOND));
  if (seconds < DISPLAY_DEFAULTS.justNowSeconds) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / HOURS_PER_DAY)}d ago`;
}

/** A timestamp in the viewer's locale, or the raw text when it does not parse. */
export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Compact uptime, e.g. "3h 12m" or "4m 7s". */
export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${Math.floor(seconds % SECONDS_PER_MINUTE)}s`;
}
