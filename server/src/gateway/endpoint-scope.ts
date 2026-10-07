import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AggregateDeps } from './aggregate-proxy.ts';
import { type InstanceKey, workspaceInstanceKey } from './instance-key.ts';
import { mergeInstructions } from './instructions.ts';
import type { GatewayManager } from './manager.ts';
import { namespaceNotification, pushNotification } from './notifications.ts';

/** For one endpoint: which server names it exposes, and which instance each one reaches. */
export interface EndpointScope {
  /** The names exposed right now. Re-read on every call, because a session outlives config edits. */
  names(): string[];
  /** The instance a name reaches; it does not check that the name is exposed. */
  keyFor(name: string): InstanceKey;
}

/**
 * Scopes an endpoint to every enabled server, each reaching its global instance.
 *
 * @param manager - Asked for the enabled names on every call.
 * @returns The scope of the global aggregate.
 */
export function globalScope(manager: GatewayManager): EndpointScope {
  return { names: () => manager.enabledNames(), keyFor: (name) => name };
}

/**
 * Scopes an endpoint to a workspace's members, each reaching its own instance in that workspace.
 *
 * @param slug - The workspace's slug, which the instance keys carry.
 * @param members - Which members are exposed right now; the caller decides whether a disabled workspace exposes any.
 * @returns The scope of that workspace's aggregate.
 */
export function workspaceScope(slug: string, members: () => string[]): EndpointScope {
  return { names: members, keyFor: (name) => workspaceInstanceKey(slug, name) };
}

/**
 * Builds what a proxy server needs from the manager, with every name resolved through the scope.
 *
 * @param manager - Where the calls, tool counts and activity end up.
 * @param scope - Maps each exposed name to its instance.
 * @returns The deps, taking server names as the endpoint exposes them.
 */
export function scopedDeps(manager: GatewayManager, scope: EndpointScope): AggregateDeps {
  return {
    withClient: (name, run) => manager.withClient(scope.keyFor(name), run),
    recordToolCount: (name, count) => manager.recordToolCount(scope.keyFor(name), count),
    recordActivity: (name, record) => manager.recordActivity(scope.keyFor(name), record),
    serverNames: () => scope.names(),
  };
}

/**
 * Merges the instructions for an aggregate session, from whatever its members have already said.
 *
 * @param manager - Holds each instance's last handshake.
 * @param scope - The members to merge, in the order `names()` gives.
 * @returns The merged text, or undefined when no member has said anything.
 *
 * @remarks
 * Never connects: a member not yet spawned in this process contributes nothing, and is picked up by the next session
 * to initialize after it wakes.
 */
export function scopedInstructions(manager: GatewayManager, scope: EndpointScope): string | undefined {
  return mergeInstructions(scope.names().map((name) => [name, manager.handshake(scope.keyFor(name)).instructions]));
}

/**
 * Relay notifications from the instances a scope exposes to an aggregate session, namespaced under each one's name.
 *
 * @param manager - The source of downstream notifications.
 * @param scope - Decides which instances are relayed; re-read for every notification.
 * @param server - The session's MCP server, which the notifications are pushed to.
 * @returns An unsubscribe function.
 */
export function relayNotifications(manager: GatewayManager, scope: EndpointScope, server: Server): () => void {
  return manager.onNotification((key, notification) => {
    const name = scope.names().find((candidate) => scope.keyFor(candidate) === key);
    if (name !== undefined) {
      pushNotification(server, namespaceNotification(notification, name));
    }
  });
}
