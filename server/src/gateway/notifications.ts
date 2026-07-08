import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Notification, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { errorMessage } from '../errors.ts';
import { namespaceName } from './naming.ts';

const RESOURCE_UPDATED = 'notifications/resources/updated';

/**
 * Re-target a downstream notification for an upstream session. On the aggregate
 * and project endpoints (`prefix` given) a `resources/updated` URI is namespaced
 * so it matches the `<server>__`-prefixed URIs the client saw in
 * `resources/list`; list_changed and log messages carry nothing to rewrite.
 */
export function namespaceNotification(notification: Notification, prefix?: string): Notification {
  const uri = notification.params?.uri;
  if (prefix && notification.method === RESOURCE_UPDATED && typeof uri === 'string') {
    return { ...notification, params: { ...notification.params, uri: namespaceName(prefix, uri) } };
  }
  return notification;
}

/**
 * Push a relayed downstream notification to an upstream session. A closed or
 * never-opened SSE stream is not an error (the SDK drops it silently); any real
 * send failure is logged, never thrown, so one dead session can't break relay.
 */
export function pushNotification(server: Server, notification: Notification): void {
  server.notification(notification as ServerNotification).catch((err: unknown) => {
    console.warn(`Failed to relay notification "${notification.method}": ${errorMessage(err)}`);
  });
}
