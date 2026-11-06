import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { ContractValidator } from '../../common/contract/contract-validator';
import type { Region } from '../../core/characters/character.types';
import { PresenceService } from '../../presence/presence.service';
import { validationError } from '../api/api-error';
import { CurrentDevice, type AuthenticatedDevice } from '../auth/current-device';
import { DeviceAuthGuard } from '../auth/device-auth.guard';
import { RATE_LIMITS, RateLimit, RateLimitGuard } from '../auth/rate-limit.guard';
import { INGEST_CLOCK, type Clock } from '../clock';

/** Body of POST /v1/heartbeat once validated against contract/schemas/heartbeat.request.json. */
export interface HeartbeatRequest {
  sentAt: number;
  gameRunning: boolean;
  appVersion: string;
  /** Unknown until the addon has written something. */
  lastCharacter?: { region: Region; firstName: string; surname: string };
}

/** heartbeat.response.json */
export interface HeartbeatResponse {
  heartbeatIntervalSec: number;
  serverTime: number;
}

/** POST /v1/heartbeat of docs/02 « Battement »: feeds the presence engine. */
@Controller('v1')
export class HeartbeatController {
  constructor(
    private readonly presence: PresenceService,
    private readonly contract: ContractValidator,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard, RateLimitGuard)
  @RateLimit(RATE_LIMITS.heartbeat)
  async beat(@CurrentDevice() device: AuthenticatedDevice, @Body() body: unknown): Promise<HeartbeatResponse> {
    const result = this.contract.validate('heartbeat.request', body);
    if (!result.ok) throw validationError(result.errors);
    const heartbeat = body as HeartbeatRequest;

    // Reception time, not sentAt: presence is about what the server heard, and when.
    const now = this.clock.now();
    await this.presence.recordHeartbeat({
      ownerId: device.ownerId,
      deviceId: device.id,
      gameRunning: heartbeat.gameRunning,
      appVersion: heartbeat.appVersion,
      lastCharacter: heartbeat.lastCharacter,
      at: now,
    });
    return { heartbeatIntervalSec: this.config.heartbeatIntervalSec, serverTime: Math.floor(now / 1_000) };
  }
}
