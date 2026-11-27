import { SETTINGS_DEFAULTS } from '@mcp-router/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** The id of the one settings row. */
export const SETTINGS_ROW_ID = 1;

/**
 * The router's settings: one row, whose columns are the keys `settingsFileSchema` describes.
 * Env vars (PORT, HOST, MCP_ROUTER_TOKEN, SECURE_LOCAL_NET) still win over these at run time.
 */
export const settings = pgTable(
  'settings',
  {
    /** Always {@link SETTINGS_ROW_ID}; the check keeps it to one row. */
    id: integer('id').primaryKey().default(SETTINGS_ROW_ID),
    port: integer('port').notNull().default(SETTINGS_DEFAULTS.port),
    /** The bearer token for /api and /mcp*. Null until first run generates one. */
    authToken: text('auth_token'),
    authEnabled: boolean('auth_enabled').notNull().default(true),
    /** Interface to bind. Null binds all interfaces. */
    host: text('host'),
    /** Extra browser Origins allowed to reach /mcp. */
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
    idleTimeoutMs: integer('idle_timeout_ms').notNull().default(SETTINGS_DEFAULTS.idleTimeoutMs),
    sessionIdleTimeoutMs: integer('session_idle_timeout_ms').notNull().default(SETTINGS_DEFAULTS.sessionIdleTimeoutMs),
    maxSessions: integer('max_sessions').notNull().default(SETTINGS_DEFAULTS.maxSessions),
    connectTimeoutMs: integer('connect_timeout_ms').notNull().default(SETTINGS_DEFAULTS.connectTimeoutMs),
    callTimeoutMs: integer('call_timeout_ms').notNull().default(SETTINGS_DEFAULTS.callTimeoutMs),
    /** The router's address as a browser reaches it. Null uses the UI's origin. */
    publicUrl: text('public_url'),
    /** The router's network name. Null until first run writes one from the hostname. */
    instanceId: text('instance_id'),
    lanAdvertise: boolean('lan_advertise').notNull().default(false),
    lanDiscovery: boolean('lan_discovery').notNull().default(true),
    /** Discovery keys of network servers the operator chose not to add. */
    lanDismissed: jsonb('lan_dismissed').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('ck_settings_single_row', sql`${table.id} = ${sql.raw(String(SETTINGS_ROW_ID))}`)],
);

/** The settings row as read. */
export type SettingsRow = typeof settings.$inferSelect;
