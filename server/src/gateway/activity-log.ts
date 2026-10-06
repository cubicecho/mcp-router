import type { ActivityEntry } from '@mcp-router/shared';

/** One call as its caller reports it; the log assigns the id. */
export type ActivityRecord = Omit<ActivityEntry, 'id'>;
