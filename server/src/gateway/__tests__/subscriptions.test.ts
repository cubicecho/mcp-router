import { describe, expect, it } from 'vitest';
import { SubscriptionLedger } from '../subscriptions.ts';

describe('SubscriptionLedger', () => {
  it('frees a uri only when its last holder lets go', () => {
    const ledger = new SubscriptionLedger();
    const a = {};
    const b = {};
    ledger.hold('alpha', 'file:///x', a);
    ledger.hold('alpha', 'file:///x', b);

    expect(ledger.release('alpha', 'file:///x', a)).toBe(false);
    expect(ledger.release('alpha', 'file:///x', b)).toBe(true);
  });

  it('counts a session that subscribes twice as one holder', () => {
    const ledger = new SubscriptionLedger();
    const a = {};
    ledger.hold('alpha', 'file:///x', a);
    ledger.hold('alpha', 'file:///x', a);

    expect(ledger.release('alpha', 'file:///x', a)).toBe(true);
  });

  it("does not let a session that never subscribed end another's subscription", () => {
    const ledger = new SubscriptionLedger();
    ledger.hold('alpha', 'file:///x', {});

    expect(ledger.release('alpha', 'file:///x', {})).toBe(false);
  });

  it('forwards an unsubscribe for a uri nobody holds, as it always was', () => {
    expect(new SubscriptionLedger().release('alpha', 'file:///x', {})).toBe(true);
  });

  it('keeps instances apart: the same uri on two of them is two subscriptions', () => {
    const ledger = new SubscriptionLedger();
    const a = {};
    ledger.hold('alpha', 'file:///x', a);
    ledger.hold('w:acme:alpha', 'file:///x', {});

    expect(ledger.release('alpha', 'file:///x', a)).toBe(true);
  });

  it('releases everything a closing session held, naming only what nobody else holds', () => {
    const ledger = new SubscriptionLedger();
    const closing = {};
    const staying = {};
    ledger.hold('alpha', 'file:///shared', closing);
    ledger.hold('alpha', 'file:///shared', staying);
    ledger.hold('alpha', 'file:///own', closing);
    ledger.hold('beta', 'file:///own', closing);

    expect(ledger.releaseAll(closing)).toEqual([
      { key: 'alpha', uri: 'file:///own' },
      { key: 'beta', uri: 'file:///own' },
    ]);
    expect(ledger.release('alpha', 'file:///shared', staying)).toBe(true);
  });

  it('forgets every holder of a removed instance', () => {
    const ledger = new SubscriptionLedger();
    const a = {};
    ledger.hold('alpha', 'file:///x', a);
    ledger.hold('alpha', 'file:///x', {});
    ledger.forget('alpha');

    expect(ledger.releaseAll(a)).toEqual([]);
  });
});
