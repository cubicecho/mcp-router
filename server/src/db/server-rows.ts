import { type ServerConfig, serverConfigSchema } from '@mcp-router/shared';
import type { ServerRow, servers } from './tables/servers.ts';

/** The columns a server's config is written to. */
export type ServerValues = Omit<typeof servers.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Turns a server's config into the columns it is stored in. An absent optional field is stored as null.
 *
 * @param config - The config, as the installer or an edit built it.
 * @returns The row's values.
 */
export function serverValues(config: ServerConfig): ServerValues {
  return {
    name: config.name,
    displayName: config.displayName ?? null,
    description: config.description ?? null,
    enabled: config.enabled,
    source: config.source,
    transport: config.transport,
    env: config.env,
    envMeta: config.envMeta,
    idleTimeoutMs: config.idleTimeoutMs ?? null,
    callTimeoutMs: config.callTimeoutMs ?? null,
    oauth: config.oauth ?? null,
    discovered: config.discovered ?? null,
  };
}

/**
 * Reads a stored server back as its config. A null column is an absent field.
 *
 * @param row - The row.
 * @returns The config, validated as the config files are.
 */
export function serverConfigOf(row: ServerRow): ServerConfig {
  const { id: _id, createdAt: _created, updatedAt: _updated, ...columns } = row;
  const present = Object.entries(columns).filter(([, value]) => value !== null);
  return serverConfigSchema.parse(Object.fromEntries(present));
}
