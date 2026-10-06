/** How often the UI re-reads live data, and how long it trusts what it has. All in ms. */

/** Router status in the sidebar and settings page. */
export const STATUS_POLL_MS = 15_000;

/** The server list: live call counts and last-called times. */
export const SERVER_LIST_POLL_MS = 5_000;

/** One server's or workspace's detail page: state and pid, members and enabled. */
export const DETAIL_POLL_MS = 10_000;

/** The activity log, while its tab is open. */
export const ACTIVITY_POLL_MS = 5_000;

/** A capability listing is reused this long before it is fetched again, since fetching may spawn a server. */
export const CAPABILITY_STALE_MS = 60_000;
