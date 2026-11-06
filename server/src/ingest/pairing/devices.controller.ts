import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ContractValidator } from '../../common/contract/contract-validator';
import { validationError } from '../api/api-error';
import { CurrentDevice, type AuthenticatedDevice } from '../auth/current-device';
import { DeviceAuthGuard } from '../auth/device-auth.guard';
import { RATE_LIMITS, RateLimit, RateLimitGuard } from '../auth/rate-limit.guard';
import { PairingService, type PairRequest, type PairResponse } from './pairing.service';

/** Pairing endpoints of docs/02 « Contrat d'échange ». */
@Controller('v1/devices')
export class DevicesController {
  constructor(
    private readonly pairing: PairingService,
    private readonly contract: ContractValidator,
  ) {}

  /** No auth; limited per IP before the body is even looked at, so guessing codes is throttled. */
  @Post('pair')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(RATE_LIMITS.pair)
  async pair(@Body() body: unknown): Promise<PairResponse> {
    const result = this.contract.validate('pair.request', body);
    if (!result.ok) throw validationError(result.errors);
    return this.pairing.pair(body as PairRequest);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(DeviceAuthGuard)
  async revokeMe(@CurrentDevice() device: AuthenticatedDevice): Promise<void> {
    await this.pairing.revoke(device.id);
  }
}
