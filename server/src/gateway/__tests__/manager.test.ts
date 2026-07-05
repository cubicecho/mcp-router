import type { ActivityEntry } from '@mcp-router/shared';
import { serverConfigSchema, settingsFileSchema } from '@mcp-router/shared';
import { describe, expect, it } from 'vitest';
import { GatewayManager } from '../manager.ts';

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
});
