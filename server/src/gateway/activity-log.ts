import type { ActivityEntry } from '@mcp-router/shared';
import { ACTIVITY_DEFAULTS } from '../core/defaults.ts';
import type { InstanceKey } from './instance-key.ts';

/** The UTF-16 code units that open a surrogate pair. */
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * Cap a string at `max` chars (never splitting a surrogate pair), appending a truncation marker.
 *
 * @param value - The string to bound.
 * @param max - Most UTF-16 code units kept; the marker is added on top of them.
 * @returns The string unchanged when it fits, else its head and a marker giving the original length.
 */
function truncateString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  // A high surrogate at the cut point would leave an unpaired half; cut before it.
  const last = value.charCodeAt(max - 1);
  const isHighSurrogate = last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST;
  const end = isHighSurrogate ? max - 1 : max;
  return `${value.slice(0, end)}… [truncated, ${value.length} chars]`;
}

/**
 * Snapshot a recorded params/result into a bounded, detached value.
 *
 * @param value - The caller's value; no reference to it is kept.
 * @returns A JSON clone, a truncated JSON string when it is over `ACTIVITY_DEFAULTS.valueMaxChars`,
 * `'[unserializable]'` when it cannot be serialized, or undefined when it serializes to nothing.
 *
 * @remarks
 * The clone cannot pin memory or alias later mutations into the log, yet keeps its shape so the UI can pretty-print
 * it. Serialization is compact so the size budget isn't spent on indentation.
 */
function snapshotValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
  if (serialized === undefined) {
    return undefined; // functions / symbols serialize to nothing
  }
  if (serialized.length > ACTIVITY_DEFAULTS.valueMaxChars) {
    return truncateString(serialized, ACTIVITY_DEFAULTS.valueMaxChars);
  }
  return JSON.parse(serialized);
}

/** One call as its caller reports it; the log assigns the id. */
export type ActivityRecord = Omit<ActivityEntry, 'id'>;

/** In-memory, per-instance ring buffer of calls, for the Activity tab. */
export class ActivityLog {
  private readonly entries = new Map<InstanceKey, ActivityEntry[]>();
  private sequence = 0;

  /**
   * Append a call to an instance's log, dropping the oldest past `ACTIVITY_DEFAULTS.maxEntries`.
   *
   * @param key - The instance the call ran against.
   * @param record - The call; its target, error, params and result are stored bounded, never by reference.
   */
  record(key: InstanceKey, record: ActivityRecord): void {
    const log = this.entries.get(key) ?? [];
    log.push({
      ...record,
      id: ++this.sequence,
      // Bound every payload-bearing field, not just params/result: error messages
      // and targets (e.g. data: URIs) can embed arbitrarily large payloads too.
      target: record.target === undefined ? undefined : truncateString(record.target, ACTIVITY_DEFAULTS.valueMaxChars),
      error: record.error === undefined ? undefined : truncateString(record.error, ACTIVITY_DEFAULTS.valueMaxChars),
      params: snapshotValue(record.params),
      result: snapshotValue(record.result),
    });
    if (log.length > ACTIVITY_DEFAULTS.maxEntries) {
      log.splice(0, log.length - ACTIVITY_DEFAULTS.maxEntries);
    }
    this.entries.set(key, log);
  }

  /**
   * Reads an instance's recorded calls, newest first.
   *
   * @param key - The instance.
   * @returns A new array of at most `ACTIVITY_DEFAULTS.maxEntries` entries; empty for an unknown key.
   */
  newestFirst(key: InstanceKey): ActivityEntry[] {
    return [...(this.entries.get(key) ?? [])].reverse();
  }

  /**
   * Forgets an instance's recorded calls.
   *
   * @param key - The instance; an unknown one is a no-op.
   */
  clear(key: InstanceKey): void {
    this.entries.delete(key);
  }
}
