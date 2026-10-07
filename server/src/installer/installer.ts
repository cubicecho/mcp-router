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
import { NPM_INSTALL_TIMEOUT_MS } from '../defaults.ts';
import { errorMessage, HttpError } from '../errors.ts';
import { isRecord } from '../is-record.ts';
import type { RegistryClient } from '../registry/client.ts';

const execFileAsync = promisify(execFile);

export type ExecFileFn = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

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
 * The local name an install gets: the one asked for, else one derived from where it comes from.
 * A remote server has nothing to derive from, so it must be named.
 */
export function resolveServerName({ name, source }: Pick<InstallRequest, 'name' | 'source'>): string {
  if (name !== undefined) {
    return name;
  }
  if (source.type === 'registry') {
    return deriveServerName(source.serverName);
  }
  if (source.type === 'npm' || source.type === 'pypi') {
    return deriveServerName(source.package);
  }
  throw new HttpError(400, 'A "name" is required when installing a remote server');
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
  if (isRecord(bin)) {
    const entries = Object.entries(bin).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
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
async function installNpmPackage(
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
    await exec('npm', ['install', '--prefix', dir, spec, '--no-audit', '--no-fund'], {
      timeout: NPM_INSTALL_TIMEOUT_MS,
    });
  } catch (cause) {
    // execFile kills the child when its timeout passes, and says so with `killed`.
    const timedOut = isRecord(cause) && cause.killed === true;
    if (timedOut) {
      throw new HttpError(
        504,
        `npm install of "${spec}" did not finish within ${NPM_INSTALL_TIMEOUT_MS} ms`,
        undefined,
        {
          cause,
        },
      );
    }
    const stderr = isRecord(cause) && typeof cause.stderr === 'string' ? cause.stderr : undefined;
    throw new HttpError(500, `npm install of "${spec}" failed`, stderr?.slice(-1000) ?? errorMessage(cause), { cause });
  }
  const packageDir = path.join(dir, 'node_modules', ...packageName.split('/'));
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  } catch (cause) {
    throw new HttpError(500, `Installed package "${packageName}" has no readable package.json`, errorMessage(cause), {
      cause,
    });
  }
  const binPath = path.resolve(
    packageDir,
    resolveBinEntry(packageName, isRecord(packageJson) ? packageJson.bin : undefined),
  );
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
function headersFromRegistry(headers: RegistryKeyValueInput[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of headers ?? []) {
    const value = header.value ?? header.default;
    if (value !== undefined) {
      result[header.name] = value;
    }
  }
  return result;
}

/** What an install source decides about a config; everything else comes from the request. */
type SourceParts = Pick<ServerConfig, 'transport'> &
  Partial<Pick<ServerConfig, 'displayName' | 'description' | 'env' | 'envMeta'>>;

type RegistrySource = Extract<InstallRequest['source'], { type: 'registry' }>;

/** A registry entry's chosen package or remote, with the env prefills and hints the entry declares. */
async function registryParts(
  request: InstallRequest,
  source: RegistrySource,
  name: string,
  deps: InstallerDeps,
): Promise<SourceParts> {
  const registry = deps.getRegistry(source.registry);
  if (!registry) {
    throw new HttpError(404, `Unknown registry "${source.registry}"`);
  }
  const entry = await deps.registryClient.getServer(registry, source.serverName);
  const selection = selectFromEntry(entry, request.packageSelector);
  const described = { displayName: entry.server.title, description: entry.server.description };
  if ('remote' in selection) {
    const remote = selection.remote;
    if (remote.type !== 'streamable-http') {
      throw new HttpError(400, `Remote transport "${remote.type}" is not supported (only streamable-http)`);
    }
    return {
      ...described,
      transport: { type: 'streamable-http', url: remote.url, headers: headersFromRegistry(remote.headers) },
    };
  }
  const pkg = selection.package;
  const version = source.version ?? pkg.version;
  const args = fixedArgsFrom(pkg.packageArguments);
  let transport: ServerTransport;
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
  const { env, envMeta } = envFromRegistry(pkg.environmentVariables);
  return { ...described, transport, env: { ...env, ...request.env }, envMeta };
}

/** The part of a config that depends on where the server comes from, installing npm packages as needed. */
async function sourceParts(request: InstallRequest, name: string, deps: InstallerDeps): Promise<SourceParts> {
  const { source } = request;
  switch (source.type) {
    case 'registry':
      return registryParts(request, source, name, deps);
    case 'npm':
      return { transport: await installNpmPackage(deps, name, source.package, source.version) };
    case 'pypi':
      return { transport: buildPypiTransport(source.package, source.version) };
    default:
      if (!request.transport) {
        throw new HttpError(400, 'A "transport" is required when installing a remote server');
      }
      return { transport: request.transport };
  }
}

/** Build a full ServerConfig from an InstallRequest, installing npm packages as needed. */
export async function buildServerConfig(request: InstallRequest, deps: InstallerDeps): Promise<ServerConfig> {
  const name = resolveServerName(request);
  return serverConfigSchema.parse({
    name,
    enabled: request.enabled,
    source: request.source,
    env: request.env,
    envMeta: {},
    ...(await sourceParts(request, name, deps)),
  });
}
