import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './api/api-exception.filter';
import { DeviceAuthGuard } from './auth/device-auth.guard';
import { RateLimitGuard } from './auth/rate-limit.guard';
import { SlidingWindowLimiter } from './auth/sliding-window-limiter';
import { INGEST_CLOCK, systemClock } from './clock';
import { DevicesController } from './pairing/devices.controller';
import { PairingService } from './pairing/pairing.service';

/**
 * Pairing, heartbeats, syncs, validation, deduplication (docs/02 « Modules »).
 * Later `/v1` controllers reuse DeviceAuthGuard, RateLimitGuard and @CurrentDevice() from here:
 * declare them in this module, or in a module that imports it.
 */
@Module({
  controllers: [DevicesController],
  providers: [
    { provide: INGEST_CLOCK, useValue: systemClock },
    // One limiter for the process: every route's budget lives here.
    { provide: SlidingWindowLimiter, useFactory: () => new SlidingWindowLimiter() },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    PairingService,
    DeviceAuthGuard,
    RateLimitGuard,
  ],
  exports: [INGEST_CLOCK, SlidingWindowLimiter, PairingService, DeviceAuthGuard, RateLimitGuard],
})
export class IngestModule {}
