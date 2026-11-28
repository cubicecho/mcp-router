import { describe, expect, it } from 'vitest';
import { formatSource } from '@/lib/server-source';

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
