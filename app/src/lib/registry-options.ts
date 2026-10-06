import type { RegistryKeyValueInput, RegistryServer } from '@mcp-router/shared';

export interface PackageOption {
  selector: string;
  label: string;
  envVars: RegistryKeyValueInput[];
}

/** Everything a registry entry can be installed from: its packages, then its remotes. */
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

/** Default: the first npm package, else the first package, else the first remote ('' when there is nothing). */
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

/** One value per declared env var, in declaration order, prefilled from the registry's value or default. */
export function defaultEnvValues(envVars: RegistryKeyValueInput[]): string[] {
  return envVars.map((envVar) => envVar.value ?? envVar.default ?? '');
}
