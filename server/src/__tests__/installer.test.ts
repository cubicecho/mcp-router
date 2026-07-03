import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Registry, RegistryServerEntry } from '@mcp-router/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../errors.ts';
import type { ExecFileFn, InstallerDeps } from '../installer/installer.ts';
import {
  buildPypiTransport,
  buildServerConfig,
  deriveServerName,
  envFromRegistry,
  fixedArgsFrom,
  installDirFor,
  resolveBinEntry,
  selectFromEntry,
  uninstall,
} from '../installer/installer.ts';
import type { RegistryClient } from '../registry/client.ts';

describe('resolveBinEntry', () => {
  it('uses a string bin directly', () => {
    expect(resolveBinEntry('@scope/pkg', 'dist/cli.js')).toBe('dist/cli.js');
  });

  it('prefers the object entry matching the package basename', () => {
    expect(resolveBinEntry('@scope/my-tool', { other: 'a.js', 'my-tool': 'b.js' })).toBe('b.js');
  });

  it('falls back to the first object entry', () => {
    expect(resolveBinEntry('pkg', { alpha: 'a.js', beta: 'b.js' })).toBe('a.js');
  });

  it('throws a friendly error when there is no bin', () => {
    expect(() => resolveBinEntry('pkg', undefined)).toThrow(/no "bin" entry/);
    expect(() => resolveBinEntry('pkg', {})).toThrow(HttpError);
  });
});

describe('deriveServerName', () => {
  it('derives from scoped npm packages', () => {
    expect(deriveServerName('@modelcontextprotocol/server-everything')).toBe('server-everything');
  });

  it('derives from registry server names and sanitizes', () => {
    expect(deriveServerName('io.github.owner/My_Repo')).toBe('my_repo');
    expect(deriveServerName('io.github.owner/--Weird  Name--')).toBe('weird-name--');
  });

  it('throws when nothing valid remains', () => {
    expect(() => deriveServerName('///')).toThrow(HttpError);
  });
});

describe('fixedArgsFrom', () => {
  it('collects positional values and named flags with values', () => {
    expect(
      fixedArgsFrom([
        { name: 'path', type: 'positional', value: '/srv' },
        { name: '--flag', type: 'named' },
        { name: '--port', type: 'named', value: '8080' },
        { name: 'optional-no-value', type: 'positional' },
        { name: 'defaulted', type: 'positional', default: 'x' },
      ]),
    ).toEqual(['/srv', '--flag', '--port', '8080', 'x']);
  });
});

describe('envFromRegistry', () => {
  it('maps registry environmentVariables to envMeta and pre-fills values', () => {
    const { env, envMeta } = envFromRegistry([
      { name: 'API_KEY', description: 'key', isRequired: true, isSecret: true },
      { name: 'REGION', default: 'us-east-1', choices: ['us-east-1', 'eu-west-1'] },
      { name: 'FIXED', value: 'always' },
    ]);
    expect(env).toEqual({ REGION: 'us-east-1', FIXED: 'always' });
    expect(envMeta.API_KEY).toMatchObject({ description: 'key', isRequired: true, isSecret: true });
    expect(envMeta.REGION?.choices).toEqual(['us-east-1', 'eu-west-1']);
  });
});

describe('buildPypiTransport', () => {
  it('runs the package via uvx and appends fixed args', () => {
    expect(buildPypiTransport('mcp-server-fetch', undefined, ['--foo'])).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch', '--foo'],
    });
  });

  it('pins the version with uv @version shorthand', () => {
    expect(buildPypiTransport('mcp-server-time', '1.4.0')).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-time@1.4.0'],
    });
  });
});

describe('selectFromEntry', () => {
  const entry: RegistryServerEntry = {
    server: {
      name: 'io.github.owner/thing',
      packages: [
        { registryType: 'pypi', identifier: 'thing-py' },
        { registryType: 'npm', identifier: 'thing-js' },
      ],
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
    },
  };

  it('defaults to the first npm package', () => {
    expect(selectFromEntry(entry, undefined)).toEqual({ package: entry.server.packages?.[1] });
  });

  it('falls back to a pypi package when no npm package exists', () => {
    const pypiOnly: RegistryServerEntry = {
      server: {
        name: 'x',
        packages: [{ registryType: 'pypi', identifier: 'thing-py' }],
        remotes: entry.server.remotes,
      },
    };
    expect(selectFromEntry(pypiOnly, undefined)).toEqual({ package: pypiOnly.server.packages?.[0] });
  });

  it('falls back to the first remote when no supported package exists', () => {
    const remoteOnly: RegistryServerEntry = {
      server: { name: 'x', remotes: entry.server.remotes },
    };
    expect(selectFromEntry(remoteOnly, undefined)).toEqual({ remote: entry.server.remotes?.[0] });
  });

  it('honors explicit package and remote selectors', () => {
    expect(selectFromEntry(entry, '0')).toEqual({ package: entry.server.packages?.[0] });
    expect(selectFromEntry(entry, 'remote:0')).toEqual({ remote: entry.server.remotes?.[0] });
  });

  it('rejects out-of-range or malformed selectors', () => {
    expect(() => selectFromEntry(entry, '9')).toThrow(HttpError);
    expect(() => selectFromEntry(entry, 'remote:9')).toThrow(HttpError);
    expect(() => selectFromEntry(entry, 'bogus')).toThrow(HttpError);
  });
});

describe('buildServerConfig', () => {
  let dataDir: string;
  let execCalls: string[][];
  let deps: InstallerDeps;

  /** execFile mock that fakes `npm install` by writing the installed package.json. */
  const fakeExec =
    (packageName: string, packageJson: Record<string, unknown>): ExecFileFn =>
    async (command, args) => {
      execCalls.push([command, ...args]);
      const prefixIndex = args.indexOf('--prefix') + 1;
      const packageDir = path.join(args[prefixIndex] as string, 'node_modules', ...packageName.split('/'));
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), JSON.stringify(packageJson));
      return { stdout: '', stderr: '' };
    };

  const officialRegistry: Registry = { name: 'official', url: 'https://registry.example' };

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-installer-'));
    execCalls = [];
    deps = {
      dataDir,
      registryClient: { getServer: vi.fn() } as unknown as RegistryClient,
      getRegistry: (name) => (name === 'official' ? officialRegistry : undefined),
    };
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('installs an npm source and derives the stdio transport from the bin field', async () => {
    deps.execFileImpl = fakeExec('@scope/echo-server', {
      name: '@scope/echo-server',
      bin: { 'echo-server': 'dist/cli.js' },
    });
    const config = await buildServerConfig(
      { source: { type: 'npm', package: '@scope/echo-server', version: '1.2.3' }, env: { KEY: 'v' }, enabled: true },
      deps,
    );
    expect(execCalls).toEqual([
      [
        'npm',
        'install',
        '--prefix',
        installDirFor(dataDir, 'echo-server'),
        '@scope/echo-server@1.2.3',
        '--no-audit',
        '--no-fund',
      ],
    ]);
    expect(config.name).toBe('echo-server');
    expect(config.transport).toEqual({
      type: 'stdio',
      command: 'node',
      args: [
        path.join(installDirFor(dataDir, 'echo-server'), 'node_modules', '@scope', 'echo-server', 'dist', 'cli.js'),
      ],
    });
    expect(config.env).toEqual({ KEY: 'v' });
  });

  it('defaults the version to latest and honors an explicit name', async () => {
    deps.execFileImpl = fakeExec('tool', { bin: 'cli.js' });
    const config = await buildServerConfig(
      { name: 'mytool', source: { type: 'npm', package: 'tool' }, env: {}, enabled: true },
      deps,
    );
    expect(execCalls[0]).toContain('tool@latest');
    expect(config.name).toBe('mytool');
  });

  it('builds a registry-sourced config: resolves the entry, installs and maps env metadata', async () => {
    const entry: RegistryServerEntry = {
      server: {
        name: 'io.github.owner/widget',
        title: 'Widget',
        description: 'A widget server',
        packages: [
          {
            registryType: 'npm',
            identifier: 'widget-mcp',
            version: '2.0.0',
            packageArguments: [{ name: 'mode', type: 'positional', value: 'serve' }],
            environmentVariables: [{ name: 'WIDGET_KEY', isRequired: true, isSecret: true }],
          },
        ],
      },
    };
    deps.registryClient = { getServer: vi.fn().mockResolvedValue(entry) } as unknown as RegistryClient;
    deps.execFileImpl = fakeExec('widget-mcp', { bin: { 'widget-mcp': 'bin/run.js' } });

    const config = await buildServerConfig(
      {
        source: { type: 'registry', registry: 'official', serverName: 'io.github.owner/widget' },
        env: { WIDGET_KEY: 'user-supplied' },
        enabled: true,
      },
      deps,
    );
    expect(execCalls[0]).toContain('widget-mcp@2.0.0');
    expect(config.name).toBe('widget');
    expect(config.displayName).toBe('Widget');
    expect(config.transport.type).toBe('stdio');
    expect(config.transport.type === 'stdio' && config.transport.args.at(-1)).toBe('serve');
    expect(config.env).toEqual({ WIDGET_KEY: 'user-supplied' });
    expect(config.envMeta.WIDGET_KEY).toMatchObject({ isRequired: true, isSecret: true });
  });

  it('builds a pypi source into a uvx transport without shelling out to npm', async () => {
    const config = await buildServerConfig(
      { source: { type: 'pypi', package: 'mcp-server-fetch', version: '1.2.3' }, env: { KEY: 'v' }, enabled: true },
      deps,
    );
    expect(execCalls).toEqual([]); // no npm install
    expect(config.name).toBe('mcp-server-fetch');
    expect(config.source).toEqual({ type: 'pypi', package: 'mcp-server-fetch', version: '1.2.3' });
    expect(config.transport).toEqual({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch@1.2.3'] });
    expect(config.env).toEqual({ KEY: 'v' });
  });

  it('builds a registry-sourced pypi config into a uvx transport and maps env metadata', async () => {
    const entry: RegistryServerEntry = {
      server: {
        name: 'io.github.owner/pywidget',
        title: 'PyWidget',
        packages: [
          {
            registryType: 'pypi',
            identifier: 'pywidget-mcp',
            version: '3.1.0',
            packageArguments: [{ name: 'mode', type: 'positional', value: 'serve' }],
            environmentVariables: [{ name: 'PY_KEY', isRequired: true, isSecret: true }],
          },
        ],
      },
    };
    deps.registryClient = { getServer: vi.fn().mockResolvedValue(entry) } as unknown as RegistryClient;

    const config = await buildServerConfig(
      {
        source: { type: 'registry', registry: 'official', serverName: 'io.github.owner/pywidget' },
        env: { PY_KEY: 'user-supplied' },
        enabled: true,
      },
      deps,
    );
    expect(execCalls).toEqual([]);
    expect(config.name).toBe('pywidget');
    expect(config.transport).toEqual({ type: 'stdio', command: 'uvx', args: ['pywidget-mcp@3.1.0', 'serve'] });
    expect(config.env).toEqual({ PY_KEY: 'user-supplied' });
    expect(config.envMeta.PY_KEY).toMatchObject({ isRequired: true, isSecret: true });
  });

  it('builds a remote proxy config from a registry remote without installing anything', async () => {
    const entry: RegistryServerEntry = {
      server: {
        name: 'io.github.owner/hosted',
        remotes: [
          { type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: [{ name: 'X-Fixed', value: 'yes' }] },
        ],
      },
    };
    deps.registryClient = { getServer: vi.fn().mockResolvedValue(entry) } as unknown as RegistryClient;
    const config = await buildServerConfig(
      {
        source: { type: 'registry', registry: 'official', serverName: 'io.github.owner/hosted' },
        env: {},
        enabled: true,
      },
      deps,
    );
    expect(execCalls).toHaveLength(0);
    expect(config.transport).toEqual({
      type: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Fixed': 'yes' },
    });
  });

  it('requires name and transport for remote sources', async () => {
    await expect(buildServerConfig({ source: { type: 'remote' }, env: {}, enabled: true }, deps)).rejects.toThrow(
      /"name" is required/,
    );
    await expect(
      buildServerConfig({ name: 'r', source: { type: 'remote' }, env: {}, enabled: true }, deps),
    ).rejects.toThrow(/"transport" is required/);
    const config = await buildServerConfig(
      {
        name: 'r',
        source: { type: 'remote' },
        transport: { type: 'streamable-http', url: 'https://r.example/mcp', headers: {} },
        env: {},
        enabled: true,
      },
      deps,
    );
    expect(config.name).toBe('r');
  });

  it('surfaces npm install failures with stderr detail', async () => {
    deps.execFileImpl = async () => {
      const err = new Error('exit 1') as Error & { stderr: string };
      err.stderr = 'npm ERR! 404 Not Found';
      throw err;
    };
    await expect(
      buildServerConfig({ source: { type: 'npm', package: 'missing-pkg' }, env: {}, enabled: true }, deps),
    ).rejects.toMatchObject({ status: 500, detail: expect.stringContaining('404 Not Found') });
  });

  it('uninstall removes the install dir', async () => {
    deps.execFileImpl = fakeExec('tool', { bin: 'cli.js' });
    await buildServerConfig({ source: { type: 'npm', package: 'tool' }, env: {}, enabled: true }, deps);
    await uninstall(dataDir, 'tool');
    const { existsSync } = await import('node:fs');
    expect(existsSync(installDirFor(dataDir, 'tool'))).toBe(false);
  });
});
