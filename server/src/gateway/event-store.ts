import type { EventId, EventStore, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/** Default per-stream-and-session cap on buffered events — enough to cover a brief reconnect. */
const DEFAULT_MAX_EVENTS = 256;

/**
 * Bounded in-memory {@link EventStore} that gives MCP sessions SSE resumability:
 * a client whose GET stream drops can reconnect with `Last-Event-ID` and receive
 * the notifications it missed. Events live in one insertion-ordered map capped at
 * `maxEvents` (oldest evicted first) so memory stays bounded even for long-lived
 * sessions — once an anchor event has aged out, replay degrades gracefully to
 * "nothing to replay". Intended to be used one-per-session so it is reclaimed with
 * the session; not durable across restarts (resumability is a best-effort MAY).
 */
export class BoundedEventStore implements EventStore {
  private readonly events = new Map<EventId, { streamId: StreamId; message: JSONRPCMessage }>();
  private readonly maxEvents: number;
  private sequence = 0;

  constructor(maxEvents: number = DEFAULT_MAX_EVENTS) {
    this.maxEvents = maxEvents;
  }

  /** streamId is the leading segment; a zero-padded monotonic counter keeps ids sortable in store order. */
  private nextEventId(streamId: StreamId): EventId {
    this.sequence += 1;
    return `${streamId}_${this.sequence.toString().padStart(16, '0')}`;
  }

  private streamIdOf(eventId: EventId): StreamId {
    return eventId.split('_')[0] ?? '';
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = this.nextEventId(streamId);
    this.events.set(eventId, { streamId, message });
    // Map preserves insertion order, so the first key is always the oldest event.
    while (this.events.size > this.maxEvents) {
      const oldest = this.events.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.events.delete(oldest);
    }
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.events.get(eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    // No anchor (or it has aged out of the buffer) → we cannot know what was missed.
    if (!lastEventId || !this.events.has(lastEventId)) {
      return '';
    }
    const streamId = this.streamIdOf(lastEventId);
    if (!streamId) {
      return '';
    }
    // Insertion order == chronological (monotonic counter), so a single forward pass
    // replays exactly the same-stream events that follow the anchor.
    let afterAnchor = false;
    for (const [eventId, event] of this.events) {
      if (event.streamId !== streamId) {
        continue;
      }
      if (eventId === lastEventId) {
        afterAnchor = true;
        continue;
      }
      if (afterAnchor) {
        await send(eventId, event.message);
      }
    }
    return streamId;
  }
}
