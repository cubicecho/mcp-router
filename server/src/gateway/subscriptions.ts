import type { InstanceKey } from './instance-key.ts';

/** A downstream subscription some session no longer shares with anyone. */
export interface FreedSubscription {
  key: InstanceKey;
  uri: string;
}

/**
 * Counts which sessions hold a `resources/subscribe` on each downstream URI.
 *
 * @remarks
 * Every session that reaches an instance shares its one downstream connection, and a subscription is per connection:
 * forwarded as-is, the second session to unsubscribe from a URI ends it for the first, which then never hears that the
 * resource changed. So an unsubscribe goes downstream only once the last holder lets go. Holders are sets rather than
 * counts because subscribing is idempotent per session: one that subscribes twice and unsubscribes once has let go.
 *
 * A subscribe is still forwarded every time, held or not. The ledger cannot see the downstream reconnect, and a child
 * respawned since the first subscribe holds none of them; a repeat subscribe is harmless where a skipped one is a
 * session that waits for updates nobody asked for.
 */
export class SubscriptionLedger {
  private readonly holders = new Map<InstanceKey, Map<string, Set<object>>>();

  /**
   * Notes that a session holds a subscription.
   *
   * @param key - The instance subscribed on.
   * @param uri - The URI as the downstream knows it.
   * @param session - The holder; any object that lives as long as the session.
   */
  hold(key: InstanceKey, uri: string, session: object): void {
    let byUri = this.holders.get(key);
    if (!byUri) {
      byUri = new Map();
      this.holders.set(key, byUri);
    }
    let sessions = byUri.get(uri);
    if (!sessions) {
      sessions = new Set();
      byUri.set(uri, sessions);
    }
    sessions.add(session);
  }

  /**
   * Lets go of a session's subscription.
   *
   * @param key - The instance.
   * @param uri - The URI as the downstream knows it.
   * @param session - The holder letting go.
   * @returns True when no session holds the URI any longer, which is when the downstream should be told; false while
   * another still does, whether or not this one ever held it.
   */
  release(key: InstanceKey, uri: string, session: object): boolean {
    const byUri = this.holders.get(key);
    const sessions = byUri?.get(uri);
    if (!byUri || !sessions) {
      // Nobody holds it: forward, as an unsubscribe always was before the ledger.
      return true;
    }
    sessions.delete(session);
    if (sessions.size > 0) {
      return false;
    }
    byUri.delete(uri);
    if (byUri.size === 0) {
      this.holders.delete(key);
    }
    return true;
  }

  /**
   * Lets go of everything a session holds, as it closes.
   *
   * @param session - The holder.
   * @returns The subscriptions it was the last holder of, for the downstream to be told.
   */
  releaseAll(session: object): FreedSubscription[] {
    const freed: FreedSubscription[] = [];
    for (const [key, byUri] of [...this.holders]) {
      for (const [uri, sessions] of [...byUri]) {
        if (sessions.has(session) && this.release(key, uri, session)) {
          freed.push({ key, uri });
        }
      }
    }
    return freed;
  }

  /**
   * Drops every subscription on an instance that no longer exists.
   *
   * @param key - The removed instance.
   */
  forget(key: InstanceKey): void {
    this.holders.delete(key);
  }
}
