import { describe, expect, it } from 'vitest';
import { formatAbsoluteTime, formatRelativeTime, formatSource, formatUptime } from '@/lib/format';

describe('formatUptime', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatUptime(0)).toBe('0m 0s');
    expect(formatUptime(247)).toBe('4m 7s');
  });

  it('shows hours and minutes from an hour up', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(3 * 3600 + 12 * 60 + 59)).toBe('3h 12m');
  });
});

describe('formatAbsoluteTime', () => {
  it('formats a timestamp in the locale', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    expect(formatAbsoluteTime(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('returns text that is not a timestamp unchanged', () => {
    expect(formatAbsoluteTime('never')).toBe('never');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-02T00:00:00.000Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it('steps from "just now" through minutes, hours and days', () => {
    expect(formatRelativeTime(ago(44), now)).toBe('just now');
    expect(formatRelativeTime(ago(5 * 60), now)).toBe('5m ago');
    expect(formatRelativeTime(ago(2 * 3600), now)).toBe('2h ago');
    expect(formatRelativeTime(ago(3 * 86400), now)).toBe('3d ago');
  });

  it('returns text that is not a timestamp unchanged', () => {
    expect(formatRelativeTime('never', now)).toBe('never');
  });
});

describe('formatSource', () => {
  it('names each kind of install source', () => {
    expect(
      formatSource({ type: 'registry', registry: 'official', serverName: 'io.github.a/b', version: '1.0.0' }),
    ).toBe('official: io.github.a/b@1.0.0');
    expect(formatSource({ type: 'npm', package: 'pkg' })).toBe('npm: pkg@latest');
    expect(formatSource({ type: 'pypi', package: 'pkg', version: '2.0' })).toBe('pypi: pkg@2.0');
    expect(formatSource({ type: 'remote' })).toBe('manual');
  });
});
