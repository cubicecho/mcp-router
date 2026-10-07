import type { EventId, EventStore, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { GATEWAY_DEFAULTS } from '../core/defaults.ts';

/** Width the counter in an event id is padded to. Sixteen digits holds every safe integer. */
const SEQUENCE_DIGITS = 16;

/**
 * Bounded in-memory {@link EventStore} that gives MCP sessions SSE resumability.
 *
 * @remarks
 * A client whose GET stream drops can reconnect with `Last-Event-ID` and receive what it missed; once that anchor
 * event has aged out, there is nothing to replay. Use one per session so it is reclaimed with the session; it is
 * not durable across restarts.
 */
export class BoundedEventStore implements EventStore {
  private readonly events = new Map<EventId, { streamId: StreamId; message: JSONRPCMessage }>();
  private readonly maxEvents: number;
  private sequence = 0;

  /**
   * Builds an empty store.
   *
   * @param [maxEvents] - Events kept across all streams; the oldest are evicted past it.
   */
  constructor(maxEvents: number = GATEWAY_DEFAULTS.maxBufferedEvents) {
    this.maxEvents = maxEvents;
  }

  /**
   * Mints the next event id for a stream.
   *
   * @param streamId - Becomes the id's leading segment.
   * @returns `<streamId>_<counter>`, the counter zero-padded so ids sort in store order.
   */
  private nextEventId(streamId: StreamId): EventId {
    this.sequence += 1;
    return `${streamId}_${this.sequence.toString().padStart(SEQUENCE_DIGITS, '0')}`;
  }

  /**
   * Reads the stream out of an event id.
   *
   * @param eventId - An id this store minted.
   * @returns The text before the first underscore.
   */
  private streamIdOf(eventId: EventId): StreamId {
    return eventId.split('_')[0] ?? '';
  }

  /**
   * Buffers a message, evicting the oldest events past the cap.
   *
   * @param streamId - The stream the message was sent on.
   * @param message - The message to keep for replay.
   * @returns The id the event was stored under.
   */
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

  /**
   * Finds the stream an event was sent on.
   *
   * @param eventId - The event to look up.
   * @returns The stream id, or undefined when the event is unknown or has been evicted.
   */
  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    return this.events.get(eventId)?.streamId;
  }

  /**
   * Resends, in order, the events that followed one on the same stream.
   *
   * @param lastEventId - The last event the client received.
   * @param options.send - Called for each later event of that stream.
   * @returns The stream id, or '' when the anchor is empty, unknown or evicted, in which case nothing is sent.
   */
  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    // No anchor (or it has aged out of the buffer) → we cannot know what was missed.
    const isBuffered = Boolean(lastEventId) && this.events.has(lastEventId);
    if (isBuffered === false) {
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
