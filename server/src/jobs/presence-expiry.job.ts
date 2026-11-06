import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PresenceService } from '../presence/presence.service';

/**
 * Every minute: closes sessions whose heartbeats stopped (heartbeat_timeout) and the 90 s waits
 * a restart interrupted (docs/02 « Transitions »). Ticks run through PresenceService, which reads
 * the time from its own clock.
 */
@Injectable()
export class PresenceExpiryJob implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly INTERVAL_MS = 60_000;
  private readonly logger = new Logger(PresenceExpiryJob.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly presence: PresenceService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), PresenceExpiryJob.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      await this.presence.tickAll();
    } catch (error) {
      this.logger.error('Presence expiry job failed', error as Error);
    }
  }
}
