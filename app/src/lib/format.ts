import { MS_PER_SECOND, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, type ServerSource, SourceType } from '@mcp-router/shared';
import { DISPLAY_DEFAULTS } from './defaults.ts';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

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

/**
 * Says how long ago an ISO timestamp was, compactly.
 *
 * @param iso - ISO 8601 timestamp.
 * @param [now] - The moment to measure from, in ms since the epoch.
 * @returns "just now", "5m ago", "2h ago" or "3d ago"; a future time reads "just now", and unparseable text comes
 * back unchanged.
 */
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

/**
 * Formats a timestamp in the viewer's locale.
 *
 * @param iso - ISO 8601 timestamp.
 * @returns The date and time, or the raw text when it does not parse.
 */
export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Formats an uptime compactly.
 *
 * @param seconds - Uptime in seconds.
 * @returns E.g. "3h 12m" from an hour up, "4m 7s" below.
 */
export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${Math.floor(seconds % SECONDS_PER_MINUTE)}s`;
}
