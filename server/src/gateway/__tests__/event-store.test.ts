import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { BoundedEventStore } from '../event-store.ts';

const msg = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', method: 'notifications/message', params: { id } });

/** Collect the (eventId, message) pairs replayed after `anchor` on `store`. */
async function replay(store: BoundedEventStore, anchor: string) {
  const replayed: Array<{ eventId: string; message: JSONRPCMessage }> = [];
  const streamId = await store.replayEventsAfter(anchor, {
    send: async (eventId, message) => {
      replayed.push({ eventId, message });
    },
  });
  return { streamId, replayed };
}

describe('BoundedEventStore', () => {
  it('replays only the events after the anchor on the same stream', async () => {
    const store = new BoundedEventStore();
    const e1 = await store.storeEvent('stream-a', msg(1));
    const e2 = await store.storeEvent('stream-a', msg(2));
    const e3 = await store.storeEvent('stream-a', msg(3));

    const { streamId, replayed } = await replay(store, e1);
    expect(streamId).toBe('stream-a');
    expect(replayed.map((r) => r.eventId)).toEqual([e2, e3]);
    expect(replayed.map((r) => r.message)).toEqual([msg(2), msg(3)]);
  });

  it('never replays events from a different stream', async () => {
    const store = new BoundedEventStore();
    const a1 = await store.storeEvent('stream-a', msg(1));
    await store.storeEvent('stream-b', msg(2));
    const a2 = await store.storeEvent('stream-a', msg(3));

    const { streamId, replayed } = await replay(store, a1);
    expect(streamId).toBe('stream-a');
    expect(replayed.map((r) => r.eventId)).toEqual([a2]);
  });

  it('returns "" and replays nothing for an empty or unknown anchor', async () => {
    const store = new BoundedEventStore();
    await store.storeEvent('stream-a', msg(1));

    expect(await replay(store, '')).toEqual({ streamId: '', replayed: [] });
    expect(await replay(store, 'stream-a_0000000000000099')).toEqual({ streamId: '', replayed: [] });
  });

  it('evicts oldest events past the cap, degrading replay to nothing once the anchor ages out', async () => {
    const store = new BoundedEventStore(2);
    const e1 = await store.storeEvent('stream-a', msg(1));
    await store.storeEvent('stream-a', msg(2));
    await store.storeEvent('stream-a', msg(3)); // evicts e1

    // e1 has aged out — we can no longer know what followed it.
    const aged = await replay(store, e1);
    expect(aged.streamId).toBe('');
    expect(aged.replayed).toEqual([]);
  });

  it('maps an event id back to its stream while it is still buffered', async () => {
    const store = new BoundedEventStore(1);
    const e1 = await store.storeEvent('stream-a', msg(1));
    expect(await store.getStreamIdForEventId(e1)).toBe('stream-a');

    const e2 = await store.storeEvent('stream-b', msg(2)); // evicts e1
    expect(await store.getStreamIdForEventId(e1)).toBeUndefined();
    expect(await store.getStreamIdForEventId(e2)).toBe('stream-b');
  });
});
