/**
 * The server's fixed tunables, in one place. What an operator can change lives in
 * settings.json (see `settingsFileSchema`); these are not configurable.
 */

/** Idle time before an inbound keep-alive connection is closed, in ms. Above the 60 s nginx and ALB hold theirs. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 75_000;

/** Idle time before an outbound connection is closed when the remote names none, in ms. Below the 60 s most servers allow. */
export const DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS = 30_000;

/** How long config-file changes are gathered before one reload, in ms. */
export const WATCH_DEBOUNCE_MS = 300;

/** How long a crashed server refuses a new connect, in ms. */
export const CRASH_BACKOFF_MS = 5_000;

/** Max activity entries kept per server (in-memory ring buffer). */
export const ACTIVITY_MAX_ENTRIES = 200;

/** Serialized params/result (and error/target strings) larger than this are truncated before storing. */
export const ACTIVITY_VALUE_MAX_CHARS = 8_000;

/** Default per-stream-and-session cap on buffered events — enough to cover a brief reconnect. */
export const DEFAULT_MAX_EVENTS = 256;

/** Delay before TCP keepalive probes start on a held GET SSE stream, in ms. */
export const STREAM_KEEPALIVE_MS = 60_000;

/** Defensive cap for draining paginated lists, against a downstream that never stops returning cursors. */
export const MAX_LIST_PAGES = 100;
