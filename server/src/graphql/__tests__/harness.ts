import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type ExecutionResult, type GraphQLSchema, graphql } from 'graphql';
import { ConfigStore } from '../../config/store.ts';
import { CALLER_OPERATOR, type Caller, type Context, type ContextDeps, UNKNOWN_IP } from '../../core/context.ts';
import type { TestDb } from '../../db/__tests__/test-db.ts';
import { idleLanServers } from '../../discovery/lan-servers.ts';
import { GatewayManager } from '../../gateway/manager.ts';
import { OAuthService } from '../../oauth/service.ts';
import { RegistryClient } from '../../registry/client.ts';
import { createSchema } from '../build-schema.ts';

/** A GraphQL response's `data`, shaped by the caller. */
// biome-ignore lint/suspicious/noExplicitAny: each test reads the fields its own query asked for
type AnyData = any;
/** Variables for one operation. */
type Variables = Record<string, unknown>;

/** A registry fetch that reaches nothing, for tests that don't browse registries. */
const NO_REGISTRY: typeof fetch = async (input) => {
  throw new Error(`No registry is reachable in this test (${String(input)}).`);
};

/** One schema per database: building it is most of what a harness costs, and only `db` shapes it. */
const schemas = new WeakMap<object, GraphQLSchema>();

/** What a refused operation answered. */
export interface Refusal {
  message: string;
  /** `extensions.code`, to compare with `ErrorCode`. */
  code: unknown;
}

/** The collaborators a resolver test drives, and a client over them. */
export interface Harness {
  /** The real file-backed store, over a temp dir. Spy on `reload` to see a write reach the gateway. */
  store: ConfigStore;
  manager: GatewayManager;
  /** Runs an operation in-process as `caller` and returns the raw result. */
  run: (query: string, variables?: Variables, caller?: Caller | null) => Promise<ExecutionResult>;
  /** Runs as the operator and returns `data`; throws the first error's cause, so a failure reads as the real bug. */
  expectOk: (query: string, variables?: Variables) => Promise<AnyData>;
  /** Runs as the operator and returns the first error. Throws on success. */
  expectError: (query: string, variables?: Variables) => Promise<Refusal>;
  /** Stops the gateway's children and removes the temp dir. */
  close: () => Promise<void>;
}

/** What a test may swap. */
export type HarnessOverrides = Partial<Pick<ContextDeps, 'registryClient' | 'lanServers'>>;

/**
 * Builds the collaborators every resolver is handed, over a test db and a temp data dir.
 *
 * @param db - The test db.
 * @param [overrides] - Collaborators to swap: a registry client over a fake fetch, found network servers.
 * @returns The harness.
 */
export async function createHarness(db: TestDb, overrides: HarnessOverrides = {}): Promise<Harness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-router-graphql-'));
  const store = new ConfigStore(dataDir);
  await store.init();
  const oauth = new OAuthService(store);
  const manager = new GatewayManager(() => store.getSettings(), oauth);
  const deps: ContextDeps = {
    db,
    store,
    manager,
    oauth,
    dataDir,
    registryClient: overrides.registryClient ?? new RegistryClient(NO_REGISTRY),
    lanServers: overrides.lanServers ?? idleLanServers(),
    startedAt: Date.now(),
  };
  const schema = schemas.get(db) ?? createSchema(db).schema;
  schemas.set(db, schema);

  const run: Harness['run'] = (query, variables, caller = CALLER_OPERATOR) => {
    const contextValue: Context = { ...deps, caller, headers: new Headers(), ip: UNKNOWN_IP };
    return graphql({ schema, source: query, contextValue, variableValues: variables });
  };
  const expectOk: Harness['expectOk'] = async (query, variables) => {
    const result = await run(query, variables);
    const [first] = result.errors ?? [];
    if (first !== undefined) {
      throw first.originalError ?? first;
    }
    return result.data;
  };
  const expectError: Harness['expectError'] = async (query, variables) => {
    const result = await run(query, variables);
    const [error] = result.errors ?? [];
    if (error === undefined) {
      throw new Error(`Expected an error, got ${JSON.stringify(result.data)}.`);
    }
    return { message: error.message, code: error.extensions.code };
  };
  const close = async () => {
    await manager.stopAll();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  return { store, manager, run, expectOk, expectError, close };
}
