import {
  ErrorCode,
  registrySchema,
  serverConfigSchema,
  settingsFileSchema,
  workspaceConfigSchema,
  workspaceMemberSchema,
} from '@mcp-router/shared';
import type { OnWriteConfig, TableWriteHooks, WriteHookPayload } from '@vantreeseba/drizzle-graphql';
import type { z } from 'zod';
import type { Context } from '../core/context.ts';
import { codedError, errorMessage } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { applyConfig } from '../gateway/reconcile.ts';

/** One written row: column values by TS key. */
export type Row = Record<string, unknown>;

/** The arguments a generated write carries rows in. */
interface WriteArgs {
  /** Rows on create. */
  values?: Row | Row[];
  /** The changed columns on update. */
  set?: Row;
  /** One entry per statement on a batch update. */
  updates?: Array<{ set?: Row }>;
}

/**
 * Collects the rows a generated write supplies, as the caller sent them.
 *
 * @param args - The root mutation field's arguments.
 * @returns One row per written set.
 */
export function writtenRows(args: WriteArgs): Row[] {
  if (args.values !== undefined) {
    return Array.isArray(args.values) ? args.values : [args.values];
  }
  if (args.updates !== undefined) {
    return args.updates.flatMap((update) => (update.set === undefined ? [] : [update.set]));
  }
  return args.set === undefined ? [] : [args.set];
}

/**
 * Drops a row's nulls, so a nullable column reads as the absent field the config schemas expect.
 *
 * @param row - A row as the database returned it.
 * @returns The row without its null columns.
 */
export function withoutNulls(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

/**
 * Re-reads the store, so the gateway sees what a write committed. `ConfigStore.reload()` emits `change`, which
 * reconciles the running servers.
 *
 * @param store - The store on the request's context.
 */
async function reloadStore({ store }: Pick<Context, 'store'>): Promise<void> {
  try {
    await store.reload();
  } catch (cause) {
    // The write has committed by now, so there is no caller left to tell: the next reload picks it up.
    console.error(`[graphql] reloading the config after a write failed: ${errorMessage(cause)}`);
  }
}

/**
 * Has the gateway reload once the write commits. Every table's `after` hook, so a nested write (were they on) would
 * reload once per table it wrote.
 *
 * @param payload - The write that just ran. A rollback drops the reload.
 */
function reloadAfterCommit({ context, onCommit }: WriteHookPayload): void {
  onCommit(() => reloadStore(context));
}

/**
 * Has the gateway take a hand-written write in at once: reload the store, then wait for the gateway to settle.
 *
 * @param ctx - The request, whose store is reloaded and whose manager is awaited.
 *
 * @remarks
 * The reload emits `change`, which starts the reconcile (`reconcileOnChange`). A hand-written mutation answers with
 * what the gateway now runs (a server's state, say), so unlike a generated write it also awaits `applyConfig`, which
 * queues behind that reconcile and finds nothing left to change.
 */
export async function settleWrite(ctx: Pick<Context, 'store' | 'manager'>): Promise<void> {
  await ctx.store.reload();
  await applyConfig(ctx);
}

/**
 * Builds a table's hooks: every written row is checked against its schema after the statement, inside the
 * transaction, and every write reloads the gateway once it commits.
 *
 * @param check - Refuses a row that breaks the table's rules. A throw rolls the write back.
 * @returns The registration.
 *
 * @remarks
 * The check reads `rows` with every column, which holds the child's own values on a nested write too (`args` is the
 * root field's there). Deletes only reload.
 */
function checkedTable(check: (row: Row) => void): TableWriteHooks {
  const checked = {
    after: ({ rows }: WriteHookPayload) => {
      for (const row of rows) {
        check(row);
      }
    },
    columns: 'all',
  } as const;
  return { after: reloadAfterCommit, insert: checked, update: checked, updateMany: checked, upsert: checked };
}

/**
 * Makes a row check from a shared schema.
 *
 * @param schema - The config schema the row's columns must satisfy.
 * @param label - What the row is, for the message.
 * @returns The check.
 */
function rowSchemaCheck(schema: z.ZodType, label: string): (row: Row) => void {
  return (row) => {
    parseOrThrow(schema, withoutNulls(row), label);
  };
}

/** The workspace columns a workspace's config file holds. */
const workspaceRow = workspaceConfigSchema.pick({ name: true, slug: true, enabled: true, description: true });

/**
 * The settings the generated `updateSetting` may change: what the UI edits. The rest (the port, the address, the
 * token, whether auth is on, the router's network name, the origins /mcp trusts) needs a restart or guards the router
 * itself, so it is changed where the router is deployed.
 */
export const EDITABLE_SETTINGS: ReadonlySet<string> = new Set([
  'idleTimeoutMs',
  'sessionIdleTimeoutMs',
  'maxSessions',
  'connectTimeoutMs',
  'callTimeoutMs',
  'publicUrl',
  'lanAdvertise',
  'lanDiscovery',
  'lanDismissed',
]);

/**
 * Refuses a settings write that names a setting the UI does not edit.
 *
 * @param payload - The write about to run.
 * @throws BAD_USER_INPUT naming the first such setting.
 */
function refuseLockedSettings({ args }: WriteHookPayload): void {
  const named = writtenRows(args).flatMap((row) => Object.keys(row));
  const locked = named.find((key) => EDITABLE_SETTINGS.has(key) === false);
  if (locked !== undefined) {
    throw codedError(ErrorCode.BadUserInput, `"${locked}" can't be changed through the API.`);
  }
}

/** Validation and gateway-reload hooks for every table, keyed by its Drizzle schema key. */
export const writeHooks: OnWriteConfig = {
  // Only reachable by a generated create, which permissions deny today: installServer is the way in.
  servers: checkedTable(rowSchemaCheck(serverConfigSchema, 'Server')),
  workspaces: checkedTable(rowSchemaCheck(workspaceRow, 'Workspace')),
  workspaceMembers: checkedTable(rowSchemaCheck(workspaceMemberSchema, 'Workspace member')),
  registries: checkedTable(rowSchemaCheck(registrySchema, 'Registry')),
  settings: {
    ...checkedTable(rowSchemaCheck(settingsFileSchema, 'Settings')),
    before: refuseLockedSettings,
  },
};
