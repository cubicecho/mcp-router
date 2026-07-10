import type { ActivityEntry } from '@mcp-router/shared';
import { serverConfigSchema, settingsFileSchema, workspaceConfigSchema } from '@mcp-router/shared';
import { describe, expect, it } from 'vitest';
import { GatewayManager, workspaceInstanceKey } from '../manager.ts';

const settings = settingsFileSchema.parse({});
const remoteConfig = (name: string) =>
  serverConfigSchema.parse({
    name,
    source: { type: 'remote' },
    transport: { type: 'streamable-http', url: 'https://example.com/mcp' },
  });

function newManager(names: string[]): GatewayManager {
  const manager = new GatewayManager(() => settings);
  manager.reconcile(names.map(remoteConfig));
  return manager;
}

const baseEntry: Omit<ActivityEntry, 'id'> = {
  at: '2026-01-01T00:00:00.000Z',
  via: 'direct',
  method: 'tools/call',
  ok: true,
  durationMs: 1,
};

describe('GatewayManager activity log', () => {
  it('stores a detached clone of result, immune to later mutation of the caller value', () => {
    const manager = newManager(['a']);
    const result = { text: 'hi', nested: { count: 1 } };
    manager.recordActivity('a', { ...baseEntry, result });
    result.text = 'MUTATED';
    result.nested.count = 99;
    expect(manager.getActivity('a')[0]?.result).toEqual({ text: 'hi', nested: { count: 1 } });
  });

  it('drops activity for a server that is not currently managed', () => {
    const manager = newManager(['a']);
    manager.recordActivity('ghost', { ...baseEntry });
    expect(manager.getActivity('ghost')).toEqual([]);
    expect(manager.getActivity('a')).toEqual([]);
  });

  it('counts recorded calls and stamps the last-called time on the status', () => {
    const manager = newManager(['a']);
    expect(manager.status('a')?.callCount).toBe(0);
    expect(manager.status('a')?.lastCalledAt).toBeUndefined();

    manager.recordActivity('a', { ...baseEntry, at: '2026-01-01T00:00:00.000Z' });
    manager.recordActivity('a', { ...baseEntry, at: '2026-01-01T00:05:00.000Z' });

    expect(manager.status('a')?.callCount).toBe(2);
    expect(manager.status('a')?.lastCalledAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('does not count activity for an unmanaged server', () => {
    const manager = newManager(['a']);
    manager.recordActivity('ghost', { ...baseEntry });
    expect(manager.status('ghost')).toBeUndefined();
    expect(manager.status('a')?.callCount).toBe(0);
  });

  it('bounds the log to the newest 200 entries, newest first', () => {
    const manager = newManager(['a']);
    for (let i = 0; i < 250; i += 1) {
      manager.recordActivity('a', { ...baseEntry, target: `t${i}` });
    }
    const log = manager.getActivity('a');
    expect(log).toHaveLength(200);
    expect(log[0]?.target).toBe('t249');
    expect(log[199]?.target).toBe('t50');
  });

  it('truncates an over-large payload to a marker string', () => {
    const manager = newManager(['a']);
    manager.recordActivity('a', { ...baseEntry, result: { big: 'x'.repeat(20_000) } });
    const stored = manager.getActivity('a')[0]?.result;
    expect(typeof stored).toBe('string');
    expect(stored).toContain('[truncated');
  });

  it('bounds over-large error and target strings too', () => {
    const manager = newManager(['a']);
    manager.recordActivity('a', {
      ...baseEntry,
      ok: false,
      target: `data:application/octet-stream;base64,${'A'.repeat(20_000)}`,
      error: `downstream failed: ${'x'.repeat(20_000)}`,
    });
    const entry = manager.getActivity('a')[0];
    expect(entry?.error?.length).toBeLessThan(9_000);
    expect(entry?.error).toContain('[truncated');
    expect(entry?.target?.length).toBeLessThan(9_000);
    expect(entry?.target).toContain('[truncated');
  });

  it('never truncates in the middle of a surrogate pair', () => {
    const manager = newManager(['a']);
    // Serialized form is `{"big":"…"}` — the 8-char prefix puts the emoji's high
    // surrogate exactly at the truncation index.
    manager.recordActivity('a', { ...baseEntry, result: { big: `${'x'.repeat(7_991)}😀${'y'.repeat(100)}` } });
    const stored = manager.getActivity('a')[0]?.result;
    expect(typeof stored).toBe('string');
    // No high surrogate left without its low half.
    expect(stored).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('GatewayManager workspaces', () => {
  const stdioConfig = (name: string) =>
    serverConfigSchema.parse({
      name,
      source: { type: 'npm', package: `pkg-${name}` },
      transport: { type: 'stdio', command: 'node', args: ['base.js'] },
      env: { BASE: '1', SHARED: 'base' },
    });

  const workspace = (members: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    workspaceConfigSchema.parse({ name: 'Acme', slug: 'acme', members, ...extra });

  it('creates a workspace-scoped instance with per-member overrides applied', () => {
    const manager = new GatewayManager(() => settings);
    manager.reconcile(
      [stdioConfig('gh')],
      [workspace({ gh: { env: { SHARED: 'override', EXTRA: 'x' }, args: ['custom.js'] } })],
    );

    const status = manager.status(workspaceInstanceKey('acme', 'gh'));
    expect(status).toBeDefined();
    // Keeps the base name (for tool namespacing) but with overrides merged in.
    expect(status?.config.name).toBe('gh');
    expect(status?.config.env).toEqual({ BASE: '1', SHARED: 'override', EXTRA: 'x' });
    expect(status?.config.transport).toMatchObject({ type: 'stdio', args: ['custom.js'] });
  });

  it('overrides a remote member URL while merging headers over the base', () => {
    const manager = new GatewayManager(() => settings);
    const remote = serverConfigSchema.parse({
      name: 'api',
      source: { type: 'remote' },
      transport: {
        type: 'streamable-http',
        url: 'http://localhost:1001/mcp',
        headers: { 'X-Base': 'base' },
      },
    });
    manager.reconcile(
      [remote],
      [
        workspace({
          api: { url: 'http://localhost:1001/mcp/w/something', headers: { Authorization: 'Bearer scoped' } },
        }),
      ],
    );

    const transport = manager.status(workspaceInstanceKey('acme', 'api'))?.config.transport;
    expect(transport).toMatchObject({
      type: 'streamable-http',
      url: 'http://localhost:1001/mcp/w/something',
      headers: { 'X-Base': 'base', Authorization: 'Bearer scoped' },
    });
  });

  it('leaves a remote member URL untouched when no url override is set', () => {
    const manager = new GatewayManager(() => settings);
    const remote = serverConfigSchema.parse({
      name: 'api',
      source: { type: 'remote' },
      transport: { type: 'streamable-http', url: 'http://localhost:1001/mcp' },
    });
    manager.reconcile([remote], [workspace({ api: {} })]);

    expect(manager.status(workspaceInstanceKey('acme', 'api'))?.config.transport).toMatchObject({
      url: 'http://localhost:1001/mcp',
    });
  });

  it('keeps workspace instances out of the base server views (statusAll / enabledNames)', () => {
    const manager = new GatewayManager(() => settings);
    manager.reconcile([stdioConfig('gh')], [workspace({ gh: {} })]);

    expect(manager.enabledNames()).toEqual(['gh']);
    expect(manager.statusAll().map((s) => s.config.name)).toEqual(['gh']);
  });

  it('runs a workspace member even when its base server is globally disabled (independent scope)', () => {
    const manager = new GatewayManager(() => settings);
    const disabledBase = serverConfigSchema.parse({ ...stdioConfig('gh'), enabled: false });
    manager.reconcile([disabledBase], [workspace({ gh: {} })]);

    // The base server is off globally...
    expect(manager.enabledNames()).toEqual([]);
    // ...but its workspace-scoped instance is enabled and connectable.
    expect(manager.status(workspaceInstanceKey('acme', 'gh'))?.config.enabled).toBe(true);
  });

  it('disables a workspace instance when the workspace itself is disabled', () => {
    const manager = new GatewayManager(() => settings);
    manager.reconcile([stdioConfig('gh')], [workspace({ gh: {} }, { enabled: false })]);

    expect(manager.status(workspaceInstanceKey('acme', 'gh'))?.config.enabled).toBe(false);
  });

  it('drops workspace instances whose base server no longer exists', () => {
    const manager = new GatewayManager(() => settings);
    manager.reconcile([stdioConfig('gh')], [workspace({ gh: {}, ghost: {} })]);

    expect(manager.status(workspaceInstanceKey('acme', 'gh'))).toBeDefined();
    expect(manager.status(workspaceInstanceKey('acme', 'ghost'))).toBeUndefined();
  });

  it('removes a workspace instance when the workspace is removed on a later reconcile', () => {
    const manager = new GatewayManager(() => settings);
    manager.reconcile([stdioConfig('gh')], [workspace({ gh: {} })]);
    expect(manager.status(workspaceInstanceKey('acme', 'gh'))).toBeDefined();

    manager.reconcile([stdioConfig('gh')], []);
    expect(manager.status(workspaceInstanceKey('acme', 'gh'))).toBeUndefined();
    // The base server survives.
    expect(manager.status('gh')).toBeDefined();
  });
});
