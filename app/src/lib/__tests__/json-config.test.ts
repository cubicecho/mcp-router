import { describe, expect, it } from 'vitest';
import { parseJsonConfig } from '@/lib/json-config';

describe('parseJsonConfig', () => {
  it('reads a bare command config', () => {
    expect(parseJsonConfig('{"command":"npx","args":["-y","pkg"],"env":{"KEY":"v"}}')).toEqual({
      name: undefined,
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { KEY: 'v' },
      extraCount: 0,
    });
  });

  it('takes the name from a named entry', () => {
    expect(parseJsonConfig('{"my-server":{"command":"node"}}')).toMatchObject({
      name: 'my-server',
      command: 'node',
      args: [],
      env: {},
    });
  });

  it('unwraps mcpServers, uses the first entry and counts the rest', () => {
    const config = parseJsonConfig('{"mcpServers":{"a":{"command":"one"},"b":{"command":"two"}}}');
    expect(config).toMatchObject({ name: 'a', command: 'one', extraCount: 1 });
  });

  it('unwraps a servers wrapper', () => {
    expect(parseJsonConfig('{"servers":{"a":{"command":"one"}}}')).toMatchObject({ name: 'a', command: 'one' });
  });

  it('tolerates trailing commas and stringifies args and env values', () => {
    expect(parseJsonConfig('{"command":"x","args":[1,true,],"env":{"PORT":8080,},}')).toMatchObject({
      args: ['1', 'true'],
      env: { PORT: '8080' },
    });
  });

  it('rejects a config with no entries, a non-object entry, or no command', () => {
    expect(() => parseJsonConfig('{}')).toThrow('No server entries found');
    expect(() => parseJsonConfig('{"a":"b"}')).toThrow('Entry "a" is not an object');
    expect(() => parseJsonConfig('{"a":{"args":[]}}')).toThrow('Config has no "command" string');
  });
});
