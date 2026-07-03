import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  EnvVarMeta,
  InstallRequest,
  Registry,
  RegistryArgument,
  RegistryKeyValueInput,
  RegistryPackage,
  RegistryRemote,
  RegistryServerEntry,
  ServerConfig,
  ServerTransport,
} from '@mcp-router/shared';
import { serverConfigSchema, serverNameSchema } from '@mcp-router/shared';
import { errorMessage, HttpError } from '../errors.ts';
import type { RegistryClient } from '../registry/client.ts';

const execFileAsync = promisify(execFile);

export type ExecFileFn = (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface InstallerDeps {
  dataDir: string;
  registryClient: RegistryClient;
  getRegistry: (name: string) => Registry | undefined;
  /** Injection point for tests; defaults to child_process.execFile (never a shell). */
  execFileImpl?: ExecFileFn;
}

export function installDirFor(dataDir: string, name: string): string {
  return path.join(dataDir, 'servers', name);
}

/** Remove a server's npm install prefix (no-op when nothing was installed). */
export async function uninstall(dataDir: string, name: string): Promise<void> {
  await rm(installDirFor(dataDir, name), { recursive: true, force: true });
}

/** Derive a valid local server name from a package or registry server name. */
export function deriveServerName(raw: string): string {
  const base = raw.split('/').pop() ?? raw;
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64);
  const result = serverNameSchema.safeParse(sanitized);
  if (!result.success) {
    throw new HttpError(400, `Cannot derive a valid server name from "${raw}"; provide "name" explicitly`);
  }
  return result.data;
}

/**
 * Resolve the bin entry of an installed package.json: a string bin is used
 * directly; for an object, prefer the entry matching the package basename,
 * else take the first one.
 */
export function resolveBinEntry(packageName: string, bin: unknown): string {
  if (typeof bin === 'string' && bin.length > 0) {
    return bin;
  }
  if (typeof bin === 'object' && bin !== null) {
    const entries = Object.entries(bin as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    const basename = packageName.split('/').pop() ?? packageName;
    const match = entries.find(([key]) => key === basename) ?? entries[0];
    if (match) {
      return match[1];
    }
  }
  throw new HttpError(500, `Package "${packageName}" has no "bin" entry; cannot derive a stdio command`);
}

/** Collect the fixed (value-carrying) registry packageArguments as CLI args. */
export function fixedArgsFrom(args: RegistryArgument[] | undefined): string[] {
  const result: string[] = [];
  for (const arg of args ?? []) {
    const value = arg.value ?? arg.default;
    if (arg.type === 'named') {
      if (arg.name) {
        result.push(arg.name);
        if (value) {
          result.push(value);
        }
      }
    } else if (value) {
      result.push(value);
    }
  }
  return result;
}

/** Map registry environmentVariables to env prefills + envMeta UI hints. */
export function envFromRegistry(vars: RegistryKeyValueInput[] | undefined): {
  env: Record<string, string>;
  envMeta: Record<string, EnvVarMeta>;
} {
  const env: Record<string, string> = {};
  const envMeta: Record<string, EnvVarMeta> = {};
  for (const v of vars ?? []) {
    envMeta[v.name] = {
      description: v.description,
      isRequired: v.isRequired,
      isSecret: v.isSecret,
      default: v.default,
      placeholder: v.placeholder,
      choices: v.choices ?? undefined,
    };
    const value = v.value ?? v.default;
    if (value !== undefined) {
      env[v.name] = value;
    }
  }
  return { env, envMeta };
}

/**
 * Pick the package or remote from a registry entry per the request's
 * packageSelector ('<index>' into packages[] or 'remote:<index>').
 * Defaults to the first npm package, else the first remote.
 */
export function selectFromEntry(
  entry: RegistryServerEntry,
  selector: string | undefined,
): { package: RegistryPackage } | { remote: RegistryRemote } {
  const packages = entry.server.packages ?? [];
  const remotes = entry.server.remotes ?? [];
  if (selector !== undefined) {
    const remoteMatch = selector.match(/^remote:(\d+)$/);
    if (remoteMatch) {
      const remote = remotes[Number(remoteMatch[1])];
      if (!remote) {
        throw new HttpError(400, `packageSelector "${selector}" does not match any remote`);
      }
      return { remote };
    }
    if (!/^\d+$/.test(selector)) {
      throw new HttpError(400, `Invalid packageSelector "${selector}" (use "<index>" or "remote:<index>")`);
    }
    const pkg = packages[Number(selector)];
    if (!pkg) {
      throw new HttpError(400, `packageSelector "${selector}" does not match any package`);
    }
    return { package: pkg };
  }
  const supportedPackage =
    packages.find((p) => p.registryType === 'npm') ?? packages.find((p) => p.registryType === 'pypi');
  if (supportedPackage) {
    return { package: supportedPackage };
  }
  const remote = remotes[0];
  if (remote) {
    return { remote };
  }
  throw new HttpError(400, 'Registry entry has no npm package and no remote to install');
}

/** npm-install a package into the server's install dir and derive its stdio transport from the bin field. */
export async function installNpmPackage(
  deps: InstallerDeps,
  serverName: string,
  packageName: string,
  version: string | undefined,
  extraArgs: string[] = [],
): Promise<ServerTransport> {
  const dir = installDirFor(deps.dataDir, serverName);
  await mkdir(dir, { recursive: true });
  const exec = deps.execFileImpl ?? execFileAsync;
  const spec = `${packageName}@${version ?? 'latest'}`;
  try {
    await exec('npm', ['install', '--prefix', dir, spec, '--no-audit', '--no-fund']);
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr;
    throw new HttpError(500, `npm install of "${spec}" failed`, stderr?.slice(-1000) ?? errorMessage(cause), { cause });
  }
  const packageDir = path.join(dir, 'node_modules', ...packageName.split('/'));
  let packageJson: { bin?: unknown };
  try {
    packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as { bin?: unknown };
  } catch (cause) {
    throw new HttpError(500, `Installed package "${packageName}" has no readable package.json`, errorMessage(cause), {
      cause,
    });
  }
  const binPath = path.resolve(packageDir, resolveBinEntry(packageName, packageJson.bin));
  return { type: 'stdio', command: 'node', args: [binPath, ...extraArgs] };
}

/**
 * Build a stdio transport that runs a PyPI package via `uvx` (uv resolves,
 * caches, and executes on spawn — no install step or install dir needed). The
 * package's console-script name is assumed to match the distribution name, per
 * the MCP registry convention (`uvx <identifier>`); a pinned version uses uv's
 * `<name>@<version>` shorthand.
 */
export function buildPypiTransport(
  packageName: string,
  version: string | undefined,
  extraArgs: string[] = [],
): ServerTransport {
  const spec = version ? `${packageName}@${version}` : packageName;
  return { type: 'stdio', command: 'uvx', args: [spec, ...extraArgs] };
}

/** Fixed headers from a registry remote's header inputs (only value-carrying entries). */
export function headersFromRegistry(headers: RegistryKeyValueInput[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers ?? []) {
    const value = header.value ?? header.default;
    if (value !== undefined) {
      result[header.name] = value;
    }
  }
  return result;
}

/** Build a full ServerConfig from an InstallRequest, installing npm packages as needed. */
export async function buildServerConfig(request: InstallRequest, deps: InstallerDeps): Promise<ServerConfig> {
  const { source } = request;
  let config: ServerConfig;
  if (source.type === 'registry') {
    const registry = deps.getRegistry(source.registry);
    if (!registry) {
      throw new HttpError(404, `Unknown registry "${source.registry}"`);
    }
    const entry = await deps.registryClient.getServer(registry, source.serverName);
    const name = request.name ?? deriveServerName(source.serverName);
    const selection = selectFromEntry(entry, request.packageSelector);
    let transport: ServerTransport;
    let env: Record<string, string> = {};
    let envMeta: Record<string, EnvVarMeta> = {};
    if ('package' in selection) {
      const pkg = selection.package;
      const version = source.version ?? pkg.version;
      const args = fixedArgsFrom(pkg.packageArguments);
      if (pkg.registryType === 'npm') {
        transport = await installNpmPackage(deps, name, pkg.identifier, version, args);
      } else if (pkg.registryType === 'pypi') {
        transport = buildPypiTransport(pkg.identifier, version, args);
      } else {
        throw new HttpError(
          400,
          `Only npm and pypi packages are supported; "${source.serverName}" offers ${pkg.registryType}`,
        );
      }
      ({ env, envMeta } = envFromRegistry(pkg.environmentVariables));
    } else {
      const remote = selection.remote;
      if (remote.type !== 'streamable-http') {
        throw new HttpError(400, `Remote transport "${remote.type}" is not supported (only streamable-http)`);
      }
      transport = { type: 'streamable-http', url: remote.url, headers: headersFromRegistry(remote.headers) };
    }
    config = {
      name,
      displayName: entry.server.title,
      description: entry.server.description,
      enabled: request.enabled,
      source,
      transport,
      env: { ...env, ...request.env },
      envMeta,
    };
  } else if (source.type === 'npm') {
    const name = request.name ?? deriveServerName(source.package);
    const transport = await installNpmPackage(deps, name, source.package, source.version);
    config = {
      name,
      enabled: request.enabled,
      source,
      transport,
      env: request.env,
      envMeta: {},
    };
  } else if (source.type === 'pypi') {
    const name = request.name ?? deriveServerName(source.package);
    const transport = buildPypiTransport(source.package, source.version);
    config = {
      name,
      enabled: request.enabled,
      source,
      transport,
      env: request.env,
      envMeta: {},
    };
  } else {
    if (!request.name) {
      throw new HttpError(400, 'A "name" is required when installing a remote server');
    }
    if (!request.transport) {
      throw new HttpError(400, 'A "transport" is required when installing a remote server');
    }
    config = {
      name: request.name,
      enabled: request.enabled,
      source,
      transport: request.transport,
      env: request.env,
      envMeta: {},
    };
  }
  return serverConfigSchema.parse(config);
}
