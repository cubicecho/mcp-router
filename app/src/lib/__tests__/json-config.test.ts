import { describe, expect, it } from 'vitest';
import { importPastedServer } from '@/lib/json-config';

describe('importPastedServer', () => {
  it('reads a bare command config, with no name', () => {
    expect(importPastedServer('{"command":"npx","args":["-y","pkg"],"env":{"KEY":"v"}}')).toEqual({
      name: undefined,
      transport: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'], cwd: undefined },
      env: { KEY: 'v' },
      extraCount: 0,
    });
  });

  it('takes the name from a named entry', () => {
    expect(importPastedServer('{"my-server":{"command":"node"}}')).toEqual({
      name: 'my-server',
      transport: { type: 'stdio', command: 'node', args: [], cwd: undefined },
      env: {},
      extraCount: 0,
    });
  });

  it('unwraps mcpServers, uses the first entry and counts the rest', () => {
    const config = importPastedServer('{"mcpServers":{"a":{"command":"one"},"b":{"command":"two"}}}');
    expect(config).toMatchObject({ name: 'a', transport: { command: 'one' }, extraCount: 1 });
  });

  it('unwraps a servers wrapper', () => {
    expect(importPastedServer('{"servers":{"a":{"command":"one"}}}')).toMatchObject({
      name: 'a',
      transport: { command: 'one' },
    });
  });

  it('keeps a working directory', () => {
    expect(importPastedServer('{"a":{"command":"node","cwd":"/srv/a"}}').transport).toMatchObject({ cwd: '/srv/a' });
  });

  it('tolerates trailing commas and stringifies args and env values', () => {
    expect(importPastedServer('{"command":"x","args":[1,true,],"env":{"PORT":8080,},}')).toMatchObject({
      transport: { args: ['1', 'true'] },
      env: { PORT: '8080' },
    });
  });

  it('reads a server with a url as streamable HTTP, with no env', () => {
    expect(
      importPastedServer('{"mcpServers":{"docs":{"url":"https://docs.example.test/mcp","headers":{"X-Key":"k"}}}}'),
    ).toEqual({
      name: 'docs',
      transport: { type: 'streamable-http', url: 'https://docs.example.test/mcp', headers: { 'X-Key': 'k' } },
      env: {},
      extraCount: 0,
    });
  });

  it('leaves placeholders as written', () => {
    // Built from parts so it reads as the text a config holds, not a template literal.
    const placeholder = ['$', '{TOKEN}'].join('');
    const pasted = JSON.stringify({ a: { command: 'x', env: { TOKEN: placeholder } } });
    expect(importPastedServer(pasted).env).toEqual({ TOKEN: placeholder });
  });

  it('accepts a key that cannot namespace tools, since the Local name field names the server', () => {
    expect(importPastedServer('{"my.server":{"command":"x"}}')).toMatchObject({ name: 'my.server' });
  });

  it('rejects text that is not JSON, a config with no entries, or a non-object entry', () => {
    expect(() => importPastedServer('not json')).toThrow('that config is not valid JSON');
    expect(() => importPastedServer('{}')).toThrow('no server found in that config');
    expect(() => importPastedServer('{"a":"b"}')).toThrow('server "a" must be an object');
  });

  it('rejects a first server the router could not run', () => {
    expect(() => importPastedServer('{"a":{"args":[]}}')).toThrow('server "a": needs a command');
    expect(() => importPastedServer('{"a":{"url":"ftp://x"}}')).toThrow(
      'server "a": "ftp://x" is not an http or https url',
    );
    expect(() => importPastedServer('{"a":{"type":"sse","url":"https://x.test/sse"}}')).toThrow(
      'server "a" is an SSE server',
    );
  });
});
