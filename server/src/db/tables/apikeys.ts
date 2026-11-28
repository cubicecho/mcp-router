import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * An API key a machine caller (an agent, an MCP client, a script) sends as `x-api-key` or `Authorization: Bearer`.
 * Owned by better-auth's api-key plugin, which reads and writes every column: only the key's hash is stored, never the
 * key itself. Revoking a key is deleting its row.
 */
export const apikeys = pgTable(
  'apikeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The plugin's configuration the key was made under. There is only `default`. */
    configId: text('config_id').notNull().default('default'),
    /** What the operator called it. */
    name: text('name'),
    /** The key's first characters, kept in the clear so the UI can tell keys apart. */
    start: text('start'),
    /** The prefix the key was minted with (`mcpr_`). Null for a key imported from the old router token. */
    prefix: text('prefix'),
    /** The key's SHA-256, base64url. What a presented key is looked up by. */
    key: text('key').notNull(),
    /**
     * Who made the key: the operator's user id, or `router` for one imported from the old router token. Not a foreign
     * key, so an imported key needs no account.
     */
    referenceId: text('reference_id').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    /** Off for every key the router makes: an MCP client makes many requests a minute. */
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(false),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    /** When the key last authenticated a request. */
    lastRequest: timestamp('last_request', { withTimezone: true }),
    /** Null for a key that never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    permissions: text('permissions'),
    /** JSON, written by the plugin: `{ kind: 'agent' }`, and `imported` for a key carried over from the old token. */
    metadata: text('metadata'),
  },
  (table) => [
    uniqueIndex('uq_apikeys_key').on(table.key),
    index('idx_apikeys_reference_id').on(table.referenceId),
    index('idx_apikeys_config_id').on(table.configId),
  ],
);

/** An API key row as read. */
export type ApiKeyRow = typeof apikeys.$inferSelect;
/** An API key row as inserted. */
export type NewApiKeyRow = typeof apikeys.$inferInsert;
