import { ErrorCode, MS_PER_SECOND, SECONDS_PER_MINUTE } from '@mcp-router/shared';
import { GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../rate-limit.ts';

const SETTINGS = { maxAttempts: 2, windowMinutes: 1 };
const WINDOW_MS = SETTINGS.windowMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Runs a hit and returns what it threw.
 *
 * @param hit - The hit.
 * @returns The refusal.
 */
function refusal(hit: () => unknown): GraphQLError {
  try {
    hit();
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the hit to be refused.');
}

describe('the sign-in throttle', () => {
  it('refuses a key past its budget with TOO_MANY_REQUESTS and how long to wait', () => {
    let clock = 0;
    const limiter = createRateLimiter(SETTINGS, () => clock);
    limiter.hit('a');
    clock = 10 * MS_PER_SECOND;
    limiter.hit('a');
    const refused = refusal(() => limiter.hit('a'));
    // The oldest attempt, at 0, leaves the window 50 s from now.
    expect(refused.extensions).toEqual({ code: ErrorCode.TooManyRequests, retryAfter: 50 });
    expect(refused.message).toContain('1 minute');
  });

  it('lets the key through again once its oldest attempt leaves the window', () => {
    let clock = 0;
    const limiter = createRateLimiter(SETTINGS, () => clock);
    limiter.hit('a');
    limiter.hit('a');
    clock = WINDOW_MS;
    expect(() => limiter.hit('a')).not.toThrow();
  });

  it('gives a refunded attempt back, so only failures count', () => {
    const limiter = createRateLimiter(SETTINGS, () => 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      limiter.hit('a')();
    }
    expect(() => limiter.hit('a')).not.toThrow();
  });

  it('counts each key on its own, and refuses when any key of a hit is spent', () => {
    const limiter = createRateLimiter(SETTINGS, () => 0);
    limiter.hit('ip', 'mail');
    limiter.hit('ip', 'mail');
    expect(() => limiter.hit('other-ip')).not.toThrow();
    expect(() => limiter.hit('other-ip', 'mail')).toThrow(GraphQLError);
  });
});
