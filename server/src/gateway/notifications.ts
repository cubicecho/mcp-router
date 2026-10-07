import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Notification } from '@modelcontextprotocol/sdk/types.js';
import { errorMessage } from '../core/errors.ts';
import { namespaceName } from './naming.ts';

/** The one relayed notification that carries a URI to rewrite. */
const RESOURCE_UPDATED = 'notifications/resources/updated';

/**
 * Re-target a downstream notification for an upstream session.
 *
 * @param notification - The notification as the downstream sent it; not mutated.
 * @param [prefix] - The server name the endpoint exposes it under; absent on a 1:1 endpoint.
 * @returns A copy with a `resources/updated` URI namespaced when `prefix` is given, else the notification itself.
 *
 * @remarks
 * The rewritten URI matches the `<server>__`-prefixed ones the client saw in `resources/list`; list_changed and log
 * messages carry nothing to rewrite.
 */
export function namespaceNotification(notification: Notification, prefix?: string): Notification {
  const uri = notification.params?.uri;
  if (prefix && notification.method === RESOURCE_UPDATED && typeof uri === 'string') {
    return { ...notification, params: { ...notification.params, uri: namespaceName(prefix, uri) } };
  }
  return notification;
}

/**
 * Push a relayed downstream notification to an upstream session.
 *
 * @param server - The session's MCP server.
 * @param notification - What to send; it is not awaited.
 *
 * @remarks
 * A closed or never-opened SSE stream is not an error (the SDK drops it silently); any real send failure is logged,
 * never thrown, so one dead session can't break relay.
 */
export function pushNotification(server: Server, notification: Notification): void {
  server.notification(notification).catch((err: unknown) => {
    console.warn(`[gateway] failed to relay notification "${notification.method}": ${errorMessage(err)}`);
  });
}
