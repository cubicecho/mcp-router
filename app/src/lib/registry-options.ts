import type { RegistryKeyValueInput, RegistryServer } from '@mcp-router/shared';

/** One way a registry entry can be installed: a package or a remote. */
export interface PackageOption {
  /** The package's index as a string, or `remote:<index>` for a remote. */
  selector: string;
  label: string;
  /** The env vars the package declares; always empty for a remote. */
  envVars: RegistryKeyValueInput[];
}

/**
 * Lists everything a registry entry can be installed from.
 *
 * @param server - The registry entry.
 * @returns Its packages, then its remotes; empty when it has neither.
 */
export function buildOptions(server: RegistryServer): PackageOption[] {
  const packages = (server.packages ?? []).map((pkg, index) => ({
    selector: String(index),
    label: `${pkg.registryType}: ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ''}`,
    envVars: pkg.environmentVariables ?? [],
  }));
  const remotes = (server.remotes ?? []).map((remote, index) => ({
    selector: `remote:${index}`,
    label: `${remote.type}: ${remote.url}`,
    envVars: [],
  }));
  return [...packages, ...remotes];
}

/**
 * Picks the install option to preselect for a registry entry.
 *
 * @param server - The registry entry.
 * @returns The selector of the first npm package, else the first package, else the first remote; `''` when there is
 * nothing to install.
 */
export function defaultSelector(server: RegistryServer): string {
  const packages = server.packages ?? [];
  const npmIndex = packages.findIndex((pkg) => pkg.registryType === 'npm');
  if (npmIndex >= 0) {
    return String(npmIndex);
  }
  if (packages.length > 0) {
    return '0';
  }
  if ((server.remotes ?? []).length > 0) {
    return 'remote:0';
  }
  return '';
}

/**
 * Prefills the env-var fields of an install option.
 *
 * @param envVars - The env vars the option declares.
 * @returns One value per env var, in declaration order: the registry's value, else its default, else `''`.
 */
export function defaultEnvValues(envVars: RegistryKeyValueInput[]): string[] {
  return envVars.map((envVar) => envVar.value ?? envVar.default ?? '');
}
