import { RateLimiter } from './rate-limiter';
import { FakeClock } from './testing/fake-clock';

describe('RateLimiter', () => {
  it('lets the first 100 requests of a second through without waiting', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, { perSecond: 100, perHour: 36_000 });

    for (let i = 0; i < 100; i++) await limiter.acquire();

    expect(clock.now()).toBe(0);
  });

  it('delays the 101st request of a second until the window slides', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, { perSecond: 100, perHour: 36_000 });

    for (let i = 0; i < 101; i++) await limiter.acquire();

    expect(clock.now()).toBe(1000);
  });

  it('enforces the hourly cap', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, { perSecond: 1000, perHour: 3 });

    for (let i = 0; i < 4; i++) await limiter.acquire();

    expect(clock.now()).toBe(3_600_000);
  });

  it('serves concurrent callers in order', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, { perSecond: 1, perHour: 100 });
    const order: number[] = [];

    await Promise.all([0, 1, 2].map((i) => limiter.acquire().then(() => order.push(i))));

    expect(order).toEqual([0, 1, 2]);
    expect(clock.now()).toBe(2000);
  });

  it('holds every request until a pause ends', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, { perSecond: 100, perHour: 36_000 });

    limiter.pauseUntil(5000);
    await limiter.acquire();

    expect(clock.now()).toBe(5000);
  });
});
