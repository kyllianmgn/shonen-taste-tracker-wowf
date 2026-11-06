import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../api/api-error';
import { INGEST_CLOCK, type Clock } from '../clock';
import type { DeviceRequest } from './current-device';
import { SlidingWindowLimiter, type WindowRule } from './sliding-window-limiter';

export interface RateLimitRule extends WindowRule {
  /** `ip` for unauthenticated routes, `device` behind DeviceAuthGuard. */
  by: 'ip' | 'device';
}

/** Limits of the endpoint table in docs/02 « Contrat d'échange ». DELETE /v1/devices/me has none. */
export const RATE_LIMITS = {
  pair: { limit: 5, windowSec: 60, by: 'ip' },
  heartbeat: { limit: 2, windowSec: 60, by: 'device' },
  sync: { limit: 2, windowSec: 60, by: 'device' },
} as const satisfies Record<string, RateLimitRule>;

/** Per-route limit, enforced by RateLimitGuard. Each route has its own budget. */
export const RateLimit = Reflector.createDecorator<RateLimitRule>();

/**
 * 429 rate_limited with `Retry-After` once a route's budget is spent. On per-device routes it must
 * come after DeviceAuthGuard: `@UseGuards(DeviceAuthGuard, RateLimitGuard)`.
 * Client IPs come from `X-Forwarded-For` through `trust proxy` (see configure-app.ts).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: SlidingWindowLimiter,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.get(RateLimit, context.getHandler());
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const subject = rule.by === 'device' ? request.device?.id : (request.ip ?? 'unknown');
    if (subject === undefined) {
      throw new Error('A per-device @RateLimit needs DeviceAuthGuard before RateLimitGuard');
    }

    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const result = this.limiter.hit(`${route}|${rule.by}:${subject}`, rule, this.clock.now());
    if (!result.allowed) throw new ApiError('rate_limited', { retryAfterSec: result.retryAfterSec });
    return true;
  }
}
