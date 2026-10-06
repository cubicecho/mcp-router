import type { RegistryServer } from '@mcp-router/shared';
import { describe, expect, it } from 'vitest';
import { buildOptions, defaultEnvValues, defaultSelector } from '@/lib/registry-options';

const pypi = { registryType: 'pypi', identifier: 'mcp-server-fetch', version: '1.2.0' };
const npm = { registryType: 'npm', identifier: '@scope/server', environmentVariables: [{ name: 'API_KEY' }] };
const remote = { type: 'streamable-http', url: 'https://example.com/mcp' };

const server = (parts: Partial<RegistryServer>): RegistryServer => ({ name: 'io.github.owner/repo', ...parts });

describe('buildOptions', () => {
  it('lists packages by index, then remotes', () => {
    expect(buildOptions(server({ packages: [pypi, npm], remotes: [remote] }))).toEqual([
      { selector: '0', label: 'pypi: mcp-server-fetch@1.2.0', envVars: [] },
      { selector: '1', label: 'npm: @scope/server', envVars: [{ name: 'API_KEY' }] },
      { selector: 'remote:0', label: 'streamable-http: https://example.com/mcp', envVars: [] },
    ]);
  });

  it('is empty for an entry with nothing to install', () => {
    expect(buildOptions(server({}))).toEqual([]);
  });
});

describe('defaultSelector', () => {
  it('prefers the first npm package', () => {
    expect(defaultSelector(server({ packages: [pypi, npm], remotes: [remote] }))).toBe('1');
  });

  it('falls back to the first package, then the first remote, then nothing', () => {
    expect(defaultSelector(server({ packages: [pypi], remotes: [remote] }))).toBe('0');
    expect(defaultSelector(server({ remotes: [remote] }))).toBe('remote:0');
    expect(defaultSelector(server({}))).toBe('');
  });
});

describe('defaultEnvValues', () => {
  it('prefills each variable from its value, else its default, else nothing', () => {
    expect(
      defaultEnvValues([
        { name: 'A', value: 'set', default: 'fallback' },
        { name: 'B', default: 'fallback' },
        { name: 'C' },
      ]),
    ).toEqual(['set', 'fallback', '']);
  });
});
