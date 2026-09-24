import { createRateLimiter } from '@studiq/server/lib/rate-limiter';
import { describe, expect, it } from 'vitest';

describe('createRateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const limiter = createRateLimiter(60_000, 3);
    const now = 1_000_000;

    expect(limiter.check('user-1', now).allowed).toBe(true);
    expect(limiter.check('user-1', now + 1).allowed).toBe(true);
    expect(limiter.check('user-1', now + 2).allowed).toBe(true);
  });

  it('blocks the request once the limit is reached within the window', () => {
    const limiter = createRateLimiter(60_000, 3);
    const now = 1_000_000;

    limiter.check('user-1', now);
    limiter.check('user-1', now + 1);
    limiter.check('user-1', now + 2);

    const result = limiter.check('user-1', now + 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows the request again once the oldest entry falls outside the window', () => {
    const limiter = createRateLimiter(60_000, 2);
    const now = 1_000_000;

    limiter.check('user-1', now);
    limiter.check('user-1', now + 100);
    expect(limiter.check('user-1', now + 200).allowed).toBe(false);

    // First request (at `now`) is now outside the 60s window.
    expect(limiter.check('user-1', now + 60_001).allowed).toBe(true);
  });

  it('tracks separate keys independently', () => {
    const limiter = createRateLimiter(60_000, 1);
    const now = 1_000_000;

    expect(limiter.check('user-1', now).allowed).toBe(true);
    expect(limiter.check('user-1', now + 1).allowed).toBe(false);
    expect(limiter.check('user-2', now + 1).allowed).toBe(true);
  });

  it('reports a positive retryAfterMs that shrinks as time passes', () => {
    const limiter = createRateLimiter(60_000, 1);
    const now = 1_000_000;

    limiter.check('user-1', now);
    const first = limiter.check('user-1', now + 10_000);
    const second = limiter.check('user-1', now + 20_000);

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs!).toBeLessThan(first.retryAfterMs!);
  });

  it('clears the whole map once it grows past 10,000 distinct keys', () => {
    const limiter = createRateLimiter(60_000, 1);
    const now = 1_000_000;

    for (let i = 0; i < 10_000; i++) {
      limiter.check(`user-${i}`, now);
    }
    // user-1 already used its one allowed request above.
    expect(limiter.check('user-1', now + 1).allowed).toBe(false);

    // Crossing the 10,000 threshold clears the map, so a key that was
    // previously rate-limited is allowed again.
    limiter.check('user-10000', now + 2);
    expect(limiter.check('user-1', now + 3).allowed).toBe(true);
  });
});
