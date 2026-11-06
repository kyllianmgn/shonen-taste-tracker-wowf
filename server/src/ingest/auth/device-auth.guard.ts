import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../api/api-error';
import { INGEST_CLOCK, type Clock } from '../clock';
import { sha256Hex } from '../pairing/pairing-secrets';
import { parseBearerToken } from './bearer';
import type { AuthenticatedDevice, DeviceRequest } from './current-device';

/**
 * Bearer authentication of the companion app (docs/02 « Contrat d'échange »), reusable on every
 * `/v1` route: `@UseGuards(DeviceAuthGuard, RateLimitGuard)`. The token is looked up by its SHA-256;
 * a revoked or deleted device gets 401 invalid_token. A successful call refreshes `last_seen_at`.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const token = parseBearerToken(request.headers.authorization);
    if (token === null) throw new ApiError('invalid_token');

    // One statement: find the live device and stamp it, so a revoked device is never touched.
    const [device] = await this.prisma.device.updateManyAndReturn({
      where: { tokenSha256: sha256Hex(token), revokedAt: null },
      data: { lastSeenAt: new Date(this.clock.now()) },
      select: { id: true, ownerId: true, name: true, appVersion: true, os: true, gameRunning: true, lastSeenAt: true },
    });
    if (!device) throw new ApiError('invalid_token');

    request.device = device satisfies AuthenticatedDevice;
    return true;
  }
}
