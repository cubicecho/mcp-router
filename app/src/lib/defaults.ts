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
  /** The servers found on the local network, in ms. */
  discoveryMs: number;
}

/** The polling intervals and stale times the query hooks use. */
export const POLLING_DEFAULTS: Readonly<PollingSettings> = Object.freeze({
  statusMs: 15_000,
  serverListMs: 5_000,
  detailMs: 10_000,
  activityMs: 5_000,
  capabilityStaleMs: 60_000,
  discoveryMs: 10_000,
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

/** The display thresholds the components use. */
export const DISPLAY_DEFAULTS: Readonly<DisplaySettings> = Object.freeze({
  jsonOpenDepth: 3,
  filterAboveServers: 5,
  argsMinRows: 3,
  argsMaxRows: 10,
  justNowSeconds: 45,
});

/**
 * How many rows each list asks the server for. The server pages every list (50 when none is named, 500 at most) and
 * refuses an operation that costs more than its limit, so a list read beside another (servers and their runtimes,
 * workspaces and their members) asks for fewer.
 */
export interface PageSettings {
  /** Installed servers, and the runtimes read beside them. */
  servers: number;
  /** Workspaces on the workspaces page. */
  workspaces: number;
  /** Workspace members, across every workspace on the workspaces page, or in one workspace. */
  workspaceMembers: number;
  /** Configured registries. */
  registries: number;
  /** One registry search page. */
  registrySearch: number;
  /** Tools, resources or prompts of one server or workspace. */
  capabilities: number;
  /** Recorded calls of one server or workspace. */
  activity: number;
  /** Servers found on the local network. */
  lanServers: number;
}

/** The page sizes the API client asks for. */
export const PAGE_DEFAULTS: Readonly<PageSettings> = Object.freeze({
  servers: 200,
  workspaces: 100,
  workspaceMembers: 300,
  registries: 100,
  registrySearch: 20,
  capabilities: 500,
  activity: 200,
  lanServers: 100,
});
