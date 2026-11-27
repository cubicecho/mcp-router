import type { ServerConfig, UpdateServerRequest } from '@mcp-router/shared';
import { applyOAuthClient, dropSignInOnMove } from '../oauth/service.ts';

/**
 * Applies an edit to a server's config, as both management doors do.
 *
 * @param existing - The config in force.
 * @param update - The validated edit. An absent key leaves its field alone.
 * @returns The new config. A URL moved to another origin drops the sign-in, and a changed client drops its tokens.
 *
 * @remarks
 * `idleTimeoutMs: null` clears the override rather than storing null; `oauthClient: null` removes the client.
 */
export function applyServerUpdate(existing: ServerConfig, update: UpdateServerRequest): ServerConfig {
  const { idleTimeoutMs, oauthClient, ...fields } = update;
  let next: ServerConfig = dropSignInOnMove(existing, { ...existing, ...fields });
  if (oauthClient !== undefined) {
    next = { ...next, oauth: applyOAuthClient(next.oauth, oauthClient) };
  }
  if (idleTimeoutMs === null) {
    const { idleTimeoutMs: _cleared, ...kept } = next;
    return kept;
  }
  if (idleTimeoutMs !== undefined) {
    return { ...next, idleTimeoutMs };
  }
  return next;
}
