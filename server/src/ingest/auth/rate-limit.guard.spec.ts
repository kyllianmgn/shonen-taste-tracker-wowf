import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../api/api-error';
import type { Clock } from '../clock';
import { RATE_LIMITS, RateLimit, RateLimitGuard, type RateLimitRule } from './rate-limit.guard';
import { SlidingWindowLimiter } from './sliding-window-limiter';

class Endpoints {
  @RateLimit({ limit: 1, windowSec: 60, by: 'ip' })
  byIp(): void {}

  @RateLimit({ limit: 1, windowSec: 60, by: 'device' })
  byDevice(): void {}

  @RateLimit({ limit: 1, windowSec: 60, by: 'ip' })
  otherByIp(): void {}

  unlimited(): void {}
}

function context(handler: keyof Endpoints, request: { ip?: string; device?: { id: string } }): ExecutionContext {
  return {
    getHandler: () => Endpoints.prototype[handler],
    getClass: () => Endpoints,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(now = 0) {
  const clock: Clock = { now: () => now };
  return new RateLimitGuard(new Reflector(), new SlidingWindowLimiter(), clock);
}

async function refusal(run: () => boolean | Promise<boolean>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('RATE_LIMITS (docs/02 « Contrat d’échange »)', () => {
  it('matches the endpoint table: pair 5/min per IP, heartbeat and sync 2/min per device', () => {
    const expected: Record<string, RateLimitRule> = {
      pair: { limit: 5, windowSec: 60, by: 'ip' },
      heartbeat: { limit: 2, windowSec: 60, by: 'device' },
      sync: { limit: 2, windowSec: 60, by: 'device' },
    };
    expect(RATE_LIMITS).toEqual(expected);
  });
});

describe('RateLimitGuard', () => {
  it('lets a route without @RateLimit through', () => {
    const g = guard();
    for (let i = 0; i < 10; i++) expect(g.canActivate(context('unlimited', { ip: '1.1.1.1' }))).toBe(true);
  });

  it('refuses with rate_limited and the Retry-After delay once the IP budget is spent', async () => {
    const g = guard(1_000);
    expect(g.canActivate(context('byIp', { ip: '1.1.1.1' }))).toBe(true);

    const error = await refusal(() => g.canActivate(context('byIp', { ip: '1.1.1.1' })));

    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSec).toBe(60);
  });

  it('counts each IP separately', () => {
    const g = guard();
    expect(g.canActivate(context('byIp', { ip: '1.1.1.1' }))).toBe(true);
    expect(g.canActivate(context('byIp', { ip: '2.2.2.2' }))).toBe(true);
  });

  it('counts per device, whatever the IP', async () => {
    const g = guard();
    expect(g.canActivate(context('byDevice', { ip: '1.1.1.1', device: { id: 'd1' } }))).toBe(true);
    expect(g.canActivate(context('byDevice', { ip: '1.1.1.1', device: { id: 'd2' } }))).toBe(true);

    const error = await refusal(() => g.canActivate(context('byDevice', { ip: '9.9.9.9', device: { id: 'd1' } })));
    expect(error.code).toBe('rate_limited');
  });

  it('keeps one budget per endpoint', () => {
    const g = guard();
    expect(g.canActivate(context('byIp', { ip: '1.1.1.1' }))).toBe(true);
    expect(g.canActivate(context('otherByIp', { ip: '1.1.1.1' }))).toBe(true);
  });

  it('fails loudly when a per-device route runs without the device guard first', () => {
    expect(() => guard().canActivate(context('byDevice', { ip: '1.1.1.1' }))).toThrow(/DeviceAuthGuard/);
  });
});
