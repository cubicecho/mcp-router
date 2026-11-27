import type { DiscoveredFrom, EnvVarMeta, ServerOAuth, ServerSource, ServerTransport } from '@mcp-router/shared';
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** One installed (or added) MCP server. The columns are `serverConfigSchema`'s keys. */
export const servers = pgTable(
  'servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The route segment (/mcp/<name>) and install dir name; `serverNameSchema` rules. */
    name: text('name').notNull(),
    displayName: text('display_name'),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    /** Where it came from: registry, npm, pypi or remote. */
    source: jsonb('source').$type<ServerSource>().notNull(),
    /** How the router reaches it: a stdio command or a streamable-HTTP URL with headers. */
    transport: jsonb('transport').$type<ServerTransport>().notNull(),
    /** Env vars for a stdio child. Plaintext. */
    env: jsonb('env').$type<Record<string, string>>().notNull().default({}),
    /** UI hints per env var, from the registry. */
    envMeta: jsonb('env_meta').$type<Record<string, EnvVarMeta>>().notNull().default({}),
    /** Overrides the settings' idle shutdown, in ms. */
    idleTimeoutMs: integer('idle_timeout_ms'),
    /** Overrides the settings' tools/call timeout, in ms. */
    callTimeoutMs: integer('call_timeout_ms'),
    /** A remote's OAuth sign-in, tokens included. Never sent to the UI. */
    oauth: jsonb('oauth').$type<ServerOAuth>(),
    /** Set when it was added from a server found on the local network. */
    discovered: jsonb('discovered').$type<DiscoveredFrom>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_servers_name').on(table.name)],
);

/** A server row as read. */
export type ServerRow = typeof servers.$inferSelect;
