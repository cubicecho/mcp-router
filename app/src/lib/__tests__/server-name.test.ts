import { describe, expect, it } from 'vitest';
import { serverLabel, serverNameError } from '@/lib/server-name';

describe('serverNameError', () => {
  it('accepts a valid name', () => {
    expect(serverNameError('my-server')).toBeUndefined();
  });

  it('explains an invalid name', () => {
    expect(serverNameError('Not Valid')).toEqual(expect.any(String));
  });

  it('rejects an empty name unless empty is allowed', () => {
    expect(serverNameError('')).toEqual(expect.any(String));
    expect(serverNameError('', { allowEmpty: true })).toBeUndefined();
  });

  it('still rejects an invalid name when empty is allowed', () => {
    expect(serverNameError('Not Valid', { allowEmpty: true })).toEqual(expect.any(String));
  });
});

describe('serverLabel', () => {
  it('prefers the display name', () => {
    expect(serverLabel('io.github.echo', 'Echo')).toBe('Echo');
  });

  it('falls back to the name when there is no display name', () => {
    expect(serverLabel('io.github.echo')).toBe('io.github.echo');
  });

  it('falls back to the name when the display name is empty', () => {
    expect(serverLabel('io.github.echo', '')).toBe('io.github.echo');
  });
});
