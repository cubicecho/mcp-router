import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  type EnvVarMeta,
  type InstallRequest,
  type Registry,
  type RegistryArgument,
  type RegistryKeyValueInput,
  type RegistryPackage,
  type RegistryRemote,
  type RegistryServerEntry,
  type ServerConfig,
  type ServerTransport,
  SourceType,
  serverConfigSchema,
  serverNameSchema,
  suggestServerName,
  TRANSPORT_STDIO,
  TRANSPORT_STREAMABLE_HTTP,
} from '@mcp-router/shared';
import { INSTALL_DEFAULTS } from '../core/defaults.ts';
import { badInput, errorMessage, internal, notFound, upstreamTimeout } from '../core/errors.ts';
import { isRecord } from '../core/is-record.ts';
import type { RegistryClient } from '../registry/client.ts';

/** `child_process.execFile` as a promise; no shell is involved. */
const execFileAsync = promisify(execFile);

/** Runs a command with an argument array; `options.timeout` is in ms. */
export type ExecFileFn = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

/** What an install needs from the rest of the router. */
export interface InstallerDeps {
  /** The data directory; npm packages are installed under its `servers` folder. */
  dataDir: string;
  registryClient: RegistryClient;
  /** Finds a configured registry; undefined when there is none by that name. */
  getRegistry: (name: string) => Registry | undefined;
  /** Injection point for tests; child_process.execFile (never a shell) when absent. */
  execFileImpl?: ExecFileFn;
}

/**
 * Names the directory a server's npm package is installed into.
 *
 * @param dataDir - The data directory.
 * @param name - The server's local name.
 * @returns `<dataDir>/servers/<name>`.
 */
export function installDirFor(dataDir: string, name: string): string {
  return path.join(dataDir, 'servers', name);
}

/**
 * Remove a server's npm install prefix (no-op when nothing was installed).
 *
 * @param dataDir - The data directory.
 * @param name - The server's local name.
 */
export async function uninstall(dataDir: string, name: string): Promise<void> {
  await rm(installDirFor(dataDir, name), { recursive: true, force: true });
}

/**
 * Derive a valid local server name from a package or registry server name.
 *
 * @param raw - The package or registry server name.
 * @returns The derived name. Throws a 400 when nothing valid can be derived.
 */
export function deriveServerName(raw: string): string {
  const result = serverNameSchema.safeParse(suggestServerName(raw));
  if (result.success === false) {
    throw badInput(`Cannot derive a valid server name from "${raw}"; provide "name" explicitly`);
  }
  return result.data;
}

/**
 * Decides the local name an install gets: the one asked for, else one derived from where it comes from.
 *
 * @param request.name - The name asked for; used as is when given.
 * @param request.source - Where the server comes from; a registry or package source has a name to derive from.
 * @returns The name. Throws a 400 for an unnamed remote server, which has nothing to derive one from.
 */
export function resolveServerName({ name, source }: Pick<InstallRequest, 'name' | 'source'>): string {
  if (name !== undefined) {
    return name;
  }
  if (source.type === SourceType.Registry) {
    return deriveServerName(source.serverName);
  }
  if (source.type === SourceType.Npm || source.type === SourceType.Pypi) {
    return deriveServerName(source.package);
  }
  throw badInput('A "name" is required when installing a remote server');
}

/**
 * Resolve the bin entry of an installed package.json.
 *
 * @param packageName - The package's name; its part after the last '/' picks among several bins.
 * @param bin - The `bin` field as read: a string is used directly; of an object, the matching entry or the first.
 * @returns The bin's path, relative to the package. Throws a 500 when there is no usable entry.
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
  throw internal(`Package "${packageName}" has no "bin" entry; cannot derive a stdio command`);
}

/**
 * Collect the fixed registry packageArguments as CLI args.
 *
 * @param args - The entry's arguments; undefined reads as none.
 * @returns A named argument as its name then its value (the name alone when it has none), a positional one as its
 * value; a positional without a value is left out.
 */
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

/**
 * Map registry environmentVariables to env prefills + envMeta UI hints.
 *
 * @param vars - The package's declared variables; undefined reads as none.
 * @returns `env` holds only the variables that carry a value or a default; `envMeta` has a hint for every one.
 */
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
 * Pick the package or remote to install from a registry entry.
 *
 * @param entry - The registry entry.
 * @param selector - `<index>` into packages[] or `remote:<index>`; undefined picks the first npm package, else the
 * first pypi one, else the first remote.
 * @returns The chosen package or remote. Throws a 400 when the selector is malformed or matches nothing, or the
 * entry has nothing installable.
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
        throw badInput(`packageSelector "${selector}" does not match any remote`);
      }
      return { remote };
    }
    const isIndex = /^\d+$/.test(selector);
    if (isIndex === false) {
      throw badInput(`Invalid packageSelector "${selector}" (use "<index>" or "remote:<index>")`);
    }
    const pkg = packages[Number(selector)];
    if (!pkg) {
      throw badInput(`packageSelector "${selector}" does not match any package`);
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
  throw badInput('Registry entry has no npm or PyPI package and no remote to install');
}

/**
 * npm-install a package into the server's install dir and derive its stdio transport from the bin field.
 *
 * @param deps - Supplies the data directory and the command runner.
 * @param serverName - The server's local name, which names the install dir.
 * @param packageName - The npm package, scope included.
 * @param version - The version or tag; undefined installs `latest`.
 * @param [extraArgs] - Appended after the bin path.
 * @returns A transport that runs the bin with `node`. Throws a 504 when npm times out, and a 500 when it fails or
 * the package has no readable package.json or bin.
 */
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
      timeout: INSTALL_DEFAULTS.npmTimeoutMs,
    });
  } catch (cause) {
    // execFile kills the child when its timeout passes, and says so with `killed`.
    const timedOut = isRecord(cause) && cause.killed === true;
    if (timedOut) {
      throw upstreamTimeout(
        `npm install of "${spec}" did not finish within ${INSTALL_DEFAULTS.npmTimeoutMs} ms`,
        undefined,
        {
          cause,
        },
      );
    }
    const stderr = isRecord(cause) && typeof cause.stderr === 'string' ? cause.stderr : undefined;
    throw internal(
      `npm install of "${spec}" failed`,
      stderr?.slice(-INSTALL_DEFAULTS.stderrTailChars) ?? errorMessage(cause),
      { cause },
    );
  }
  const packageDir = path.join(dir, 'node_modules', ...packageName.split('/'));
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  } catch (cause) {
    throw internal(`Installed package "${packageName}" has no readable package.json`, errorMessage(cause), {
      cause,
    });
  }
  const binPath = path.resolve(
    packageDir,
    resolveBinEntry(packageName, isRecord(packageJson) ? packageJson.bin : undefined),
  );
  return { type: TRANSPORT_STDIO, command: 'node', args: [binPath, ...extraArgs] };
}

/**
 * Build a stdio transport that runs a PyPI package via `uvx`.
 *
 * @param packageName - The distribution name, assumed to be its console-script name too.
 * @param version - Pins the version with uv's `<name>@<version>` shorthand; undefined or empty leaves it unpinned.
 * @param [extraArgs] - Appended after the package spec.
 * @returns The transport.
 *
 * @remarks
 * uv resolves, caches and executes on spawn, so there is no install step or install dir. The script name matching the
 * distribution name is the MCP registry convention (`uvx <identifier>`).
 */
export function buildPypiTransport(
  packageName: string,
  version: string | undefined,
  extraArgs: string[] = [],
): ServerTransport {
  const spec = version ? `${packageName}@${version}` : packageName;
  return { type: TRANSPORT_STDIO, command: 'uvx', args: [spec, ...extraArgs] };
}

/**
 * Collects the fixed headers from a registry remote's header inputs.
 *
 * @param headers - The remote's declared headers; undefined reads as none.
 * @returns The headers that carry a value or a default.
 */
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

/** The registry arm of an install request's source. */
type RegistrySource = Extract<InstallRequest['source'], { type: typeof SourceType.Registry }>;

/**
 * Resolves a registry entry's chosen package or remote, with the env prefills and hints the entry declares.
 *
 * @param request - Read for the package selector and the env that overrides the prefills.
 * @param source - Names the registry, the entry and an optional version that wins over the entry's.
 * @param name - The server's local name, which names an npm install dir.
 * @param deps - Reaches the registry and runs npm.
 * @returns The parts. Throws a 404 for an unknown registry or entry, and a 400 for a remote that is not
 * streamable-http or a package that is neither npm nor pypi.
 */
async function registryParts(
  request: InstallRequest,
  source: RegistrySource,
  name: string,
  deps: InstallerDeps,
): Promise<SourceParts> {
  const registry = deps.getRegistry(source.registry);
  if (!registry) {
    throw notFound(`Unknown registry "${source.registry}"`);
  }
  const entry = await deps.registryClient.getServer(registry, source.serverName);
  const selection = selectFromEntry(entry, request.packageSelector);
  const described = { displayName: entry.server.title, description: entry.server.description };
  if ('remote' in selection) {
    const remote = selection.remote;
    if (remote.type !== TRANSPORT_STREAMABLE_HTTP) {
      throw badInput(`Remote transport "${remote.type}" is not supported (only streamable-http)`);
    }
    return {
      ...described,
      transport: { type: TRANSPORT_STREAMABLE_HTTP, url: remote.url, headers: headersFromRegistry(remote.headers) },
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
    throw badInput(`Only npm and pypi packages are supported; "${source.serverName}" offers ${pkg.registryType}`);
  }
  const { env, envMeta } = envFromRegistry(pkg.environmentVariables);
  return { ...described, transport, env: { ...env, ...request.env }, envMeta };
}

/**
 * Builds the part of a config that depends on where the server comes from, installing npm packages as needed.
 *
 * @param request - The install request; a remote source takes its `transport` from here.
 * @param name - The server's local name.
 * @param deps - Reaches the registry and runs npm.
 * @returns The parts. Throws a 400 for a remote source with no transport.
 */
async function sourceParts(request: InstallRequest, name: string, deps: InstallerDeps): Promise<SourceParts> {
  const { source } = request;
  switch (source.type) {
    case SourceType.Registry:
      return registryParts(request, source, name, deps);
    case SourceType.Npm:
      return { transport: await installNpmPackage(deps, name, source.package, source.version) };
    case SourceType.Pypi:
      return { transport: buildPypiTransport(source.package, source.version) };
    default:
      if (!request.transport) {
        throw badInput('A "transport" is required when installing a remote server');
      }
      return { transport: request.transport };
  }
}

/**
 * Build a full ServerConfig from an InstallRequest, installing npm packages as needed.
 *
 * @param request - The validated install request.
 * @param deps - Reaches the registry and runs npm.
 * @returns The validated config. Nothing is saved; an npm package is already on disk by then.
 */
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
