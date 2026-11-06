import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ContractValidator } from '../../common/contract/contract-validator';
import { ApiError, validationError } from '../api/api-error';
import { CurrentDevice, type AuthenticatedDevice } from '../auth/current-device';
import { DeviceAuthGuard } from '../auth/device-auth.guard';
import { RATE_LIMITS, RateLimit, RateLimitGuard } from '../auth/rate-limit.guard';
import { SyncService } from './sync.service';
import { SYNC_SCHEMA_VERSION, type SyncRequest, type SyncResponse } from './sync.types';

/** POST /v1/sync of docs/02 « Contrat d'échange ». The body limit (512 KiB) is set in configure-app.ts. */
@Controller('v1')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly contract: ContractValidator,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceAuthGuard, RateLimitGuard)
  @RateLimit(RATE_LIMITS.sync)
  async ingest(@CurrentDevice() device: AuthenticatedDevice, @Body() body: unknown): Promise<SyncResponse> {
    // A numeric version we do not know is a newer app, not a malformed body.
    const schema = (body as { schema?: unknown } | null)?.schema;
    if (typeof schema === 'number' && schema !== SYNC_SCHEMA_VERSION) throw new ApiError('unknown_schema');

    const result = this.contract.validate('sync.request', body);
    if (!result.ok) throw validationError(result.errors);
    return this.sync.ingest({ ownerId: device.ownerId, payload: body as SyncRequest, source: 'app' });
  }
}
