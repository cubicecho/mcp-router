import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type InstanceKey, workspaceInstanceKey } from './instance-key.ts';
import type { GatewayManager } from './manager.ts';
import { namespaceNotification, pushNotification } from './notifications.ts';
import { type AggregateDeps, mergeInstructions } from './proxy.ts';

/** For one endpoint: which server names it exposes, and which instance each one reaches. */
export interface EndpointScope {
  /** The names exposed right now. Re-read on every call, because a session outlives config edits. */
  names(): string[];
  keyFor(name: string): InstanceKey;
}

/** Every enabled server, each reaching its global instance. */
export function globalScope(manager: GatewayManager): EndpointScope {
  return { names: () => manager.enabledNames(), keyFor: (name) => name };
}

/**
 * A workspace's members, each reaching its own instance in that workspace.
 *
 * @param members - Which members are exposed right now; the caller decides whether a disabled workspace exposes any.
 */
export function workspaceScope(slug: string, members: () => string[]): EndpointScope {
  return { names: members, keyFor: (name) => workspaceInstanceKey(slug, name) };
}

/** What a proxy server needs from the manager, with every name resolved through the scope. */
export function scopedDeps(manager: GatewayManager, scope: EndpointScope): AggregateDeps {
  return {
    withClient: (name, run) => manager.withClient(scope.keyFor(name), run),
    recordToolCount: (name, count) => manager.recordToolCount(scope.keyFor(name), count),
    recordActivity: (name, record) => manager.recordActivity(scope.keyFor(name), record),
    serverNames: () => scope.names(),
  };
}

/**
 * The merged instructions for an aggregate session, from whatever its members have already said.
 *
 * Never connects: a member not yet spawned in this process contributes nothing, and is picked up
 * by the next session to initialize after it wakes.
 */
export function scopedInstructions(manager: GatewayManager, scope: EndpointScope): string | undefined {
  return mergeInstructions(scope.names().map((name) => [name, manager.handshake(scope.keyFor(name)).instructions]));
}

/**
 * Relay notifications from the instances a scope exposes to an aggregate session, namespaced
 * under the name each is exposed as.
 *
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
