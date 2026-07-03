import { describe, expect, it } from 'vitest';
import { namespaceName, splitNamespacedName } from '../gateway/naming.ts';

describe('aggregate namespacing', () => {
  it('prefixes names with <server>__', () => {
    expect(namespaceName('everything', 'echo')).toBe('everything__echo');
  });

  it('splits a namespaced name back into server and tool', () => {
    expect(splitNamespacedName('everything__echo', ['everything', 'other'])).toEqual({
      serverName: 'everything',
      name: 'echo',
    });
  });

  it('round-trips names that themselves contain the separator', () => {
    const full = namespaceName('srv', 'weird__tool__name');
    expect(splitNamespacedName(full, ['srv'])).toEqual({ serverName: 'srv', name: 'weird__tool__name' });
  });

  it('prefers the longest matching server name when names are ambiguous', () => {
    // Server names may contain underscores, so 'a__b' and 'a' can both exist.
    expect(splitNamespacedName('a__b__tool', ['a', 'a__b'])).toEqual({ serverName: 'a__b', name: 'tool' });
    expect(splitNamespacedName('a__tool', ['a', 'a__b'])).toEqual({ serverName: 'a', name: 'tool' });
  });

  it('returns undefined for unknown servers or empty names', () => {
    expect(splitNamespacedName('unknown__tool', ['a'])).toBeUndefined();
    expect(splitNamespacedName('a__', ['a'])).toBeUndefined();
    expect(splitNamespacedName('no-separator', ['a'])).toBeUndefined();
  });
});
