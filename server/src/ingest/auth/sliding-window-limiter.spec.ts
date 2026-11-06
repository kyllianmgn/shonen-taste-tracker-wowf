import { SlidingWindowLimiter } from './sliding-window-limiter';

const RULE = { limit: 2, windowSec: 60 };

describe('SlidingWindowLimiter', () => {
  it('allows up to `limit` hits per window, then refuses with the seconds until a slot frees up', () => {
    const limiter = new SlidingWindowLimiter();

    expect(limiter.hit('k', RULE, 0)).toEqual({ allowed: true });
    expect(limiter.hit('k', RULE, 10_000)).toEqual({ allowed: true });
    expect(limiter.hit('k', RULE, 20_000)).toEqual({ allowed: false, retryAfterSec: 40 });
  });

  it('frees a slot once the oldest hit leaves the window', () => {
    const limiter = new SlidingWindowLimiter();
    limiter.hit('k', RULE, 0);
    limiter.hit('k', RULE, 10_000);

    expect(limiter.hit('k', RULE, 59_999)).toEqual({ allowed: false, retryAfterSec: 1 });
    expect(limiter.hit('k', RULE, 60_000)).toEqual({ allowed: true });
    expect(limiter.hit('k', RULE, 60_001)).toEqual({ allowed: false, retryAfterSec: 10 });
  });

  it('does not count refused hits', () => {
    const limiter = new SlidingWindowLimiter();
    limiter.hit('k', RULE, 0);
    limiter.hit('k', RULE, 0);
    for (let t = 1_000; t < 60_000; t += 1_000) limiter.hit('k', RULE, t);

    expect(limiter.hit('k', RULE, 60_000)).toEqual({ allowed: true });
  });

  it('rounds Retry-After up and never answers 0', () => {
    const limiter = new SlidingWindowLimiter();
    limiter.hit('k', { limit: 1, windowSec: 60 }, 0);

    expect(limiter.hit('k', { limit: 1, windowSec: 60 }, 500)).toEqual({ allowed: false, retryAfterSec: 60 });
    expect(limiter.hit('k', { limit: 1, windowSec: 60 }, 59_900)).toEqual({ allowed: false, retryAfterSec: 1 });
  });

  it('keeps one budget per key', () => {
    const limiter = new SlidingWindowLimiter();
    limiter.hit('a', RULE, 0);
    limiter.hit('a', RULE, 0);

    expect(limiter.hit('a', RULE, 0).allowed).toBe(false);
    expect(limiter.hit('b', RULE, 0).allowed).toBe(true);
  });

  it('forgets keys whose hits all left the window', () => {
    const limiter = new SlidingWindowLimiter({ sweepEvery: 3 });
    limiter.hit('a', RULE, 0);
    limiter.hit('b', RULE, 0);
    expect(limiter.size()).toBe(2);

    limiter.hit('c', RULE, 61_000);

    expect(limiter.size()).toBe(1);
  });
});
