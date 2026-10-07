// Every value in the UI someone might tune, as plain data. Nothing here computes or imports.

/** How often the UI re-reads live data, and how long it trusts what it has. */
export interface PollingSettings {
  /** Router status in the sidebar and settings page, in ms. */
  statusMs: number;
  /** The server list: live call counts and last-called times, in ms. */
  serverListMs: number;
  /** One server's or workspace's detail page: state and pid, members and enabled, in ms. */
  detailMs: number;
  /** The activity log, while its tab is open, in ms. */
  activityMs: number;
  /** How long a capability listing is reused before it is fetched again, in ms. Fetching may spawn a server. */
  capabilityStaleMs: number;
}

export const POLLING_DEFAULTS: Readonly<PollingSettings> = Object.freeze({
  statusMs: 15_000,
  serverListMs: 5_000,
  detailMs: 10_000,
  activityMs: 5_000,
  capabilityStaleMs: 60_000,
});

/** How much the UI shows before it asks for a click. */
export interface DisplaySettings {
  /** Levels of a JSON value that start open. Deeper ones start folded. */
  jsonOpenDepth: number;
  /** The server list gets a filter box once it has more rows than this. */
  filterAboveServers: number;
  /** Fewest rows of a tool's arguments box. */
  argsMinRows: number;
  /** Most rows of a tool's arguments box before it scrolls. */
  argsMaxRows: number;
  /** A time newer than this reads "just now", in seconds. */
  justNowSeconds: number;
}

export const DISPLAY_DEFAULTS: Readonly<DisplaySettings> = Object.freeze({
  jsonOpenDepth: 3,
  filterAboveServers: 5,
  argsMinRows: 3,
  argsMaxRows: 10,
  justNowSeconds: 45,
});
