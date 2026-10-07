import { describe, expect, it } from 'vitest';
import { slugify, suggestServerName } from '../config.ts';

describe('suggestServerName', () => {
  it('uses the last path segment, lower-cased and made URL-safe', () => {
    expect(suggestServerName('io.github.Owner/My Repo')).toBe('my-repo');
    expect(suggestServerName('@scope/server-everything')).toBe('server-everything');
  });

  it('keeps a trailing dash, which slugify removes', () => {
    expect(suggestServerName('owner/--Weird  Name--')).toBe('weird-name--');
    expect(slugify('--Weird  Name--')).toBe('weird-name');
  });

  it('is empty when no usable character is left', () => {
    expect(suggestServerName('///')).toBe('');
  });
});
