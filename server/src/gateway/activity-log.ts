import type { ActivityEntry } from '@mcp-router/shared';
import type { InstanceKey } from './instance-key.ts';

/** Max activity entries kept per server (in-memory ring buffer). */
const ACTIVITY_LIMIT = 200;
/** Serialized params/result (and error/target strings) larger than this are truncated before storing. */
const ACTIVITY_VALUE_CHARS = 8_000;

/** Cap a string at `max` chars (never splitting a surrogate pair), appending a truncation marker. */
function truncateString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  // A high surrogate at the cut point would leave an unpaired half; cut before it.
  const last = value.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return `${value.slice(0, end)}… [truncated, ${value.length} chars]`;
}

/**
 * Snapshot a recorded params/result into a bounded, detached value.
 *
 * Never retains a reference to the caller's value: a small payload is returned
 * as a fresh structural clone (so it can't pin memory or alias later mutations
 * into the log, yet keeps its shape — the schema's `unknown` stays truthful and
 * the UI can pretty-print it), and an over-large one collapses to a truncation
 * marker string. Serialization is compact so the size budget isn't spent on
 * indentation.
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
  if (serialized.length > ACTIVITY_VALUE_CHARS) {
    return truncateString(serialized, ACTIVITY_VALUE_CHARS);
  }
  return JSON.parse(serialized);
}

/** One call as its caller reports it; the log assigns the id. */
export type ActivityRecord = Omit<ActivityEntry, 'id'>;

/** In-memory, per-instance ring buffer of calls, for the Activity tab. */
export class ActivityLog {
  private readonly entries = new Map<InstanceKey, ActivityEntry[]>();
  private sequence = 0;

  /** Append a call to an instance's log, dropping the oldest past {@link ACTIVITY_LIMIT}. */
  record(key: InstanceKey, record: ActivityRecord): void {
    const log = this.entries.get(key) ?? [];
    log.push({
      ...record,
      id: ++this.sequence,
      // Bound every payload-bearing field, not just params/result: error messages
      // and targets (e.g. data: URIs) can embed arbitrarily large payloads too.
      target: record.target === undefined ? undefined : truncateString(record.target, ACTIVITY_VALUE_CHARS),
      error: record.error === undefined ? undefined : truncateString(record.error, ACTIVITY_VALUE_CHARS),
      params: snapshotValue(record.params),
      result: snapshotValue(record.result),
    });
    if (log.length > ACTIVITY_LIMIT) {
      log.splice(0, log.length - ACTIVITY_LIMIT);
    }
    this.entries.set(key, log);
  }

  /** An instance's recorded calls, newest first (at most {@link ACTIVITY_LIMIT}). */
  newestFirst(key: InstanceKey): ActivityEntry[] {
    return [...(this.entries.get(key) ?? [])].reverse();
  }

  clear(key: InstanceKey): void {
    this.entries.delete(key);
  }
}
