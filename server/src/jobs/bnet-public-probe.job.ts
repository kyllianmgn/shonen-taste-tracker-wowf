import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PublicProfileProbe } from '../bnet/public/public-profile-probe.service';

/** docs/02 « Fiche publique »: the public profile is tested once a day. */
export const BNET_PUBLIC_PROBE_INTERVAL_MS = 24 * 3_600_000;

/**
 * Runs the public profile test at startup (the gate lives in memory) and then daily. A failing
 * test is logged and retried the next day.
 */
@Injectable()
export class BnetPublicProbeJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BnetPublicProbeJob.name);
  private timer?: NodeJS.Timeout;
  private startup?: NodeJS.Timeout;

  constructor(private readonly probe: PublicProfileProbe) {}

  onApplicationBootstrap(): void {
    this.startup = setTimeout(() => void this.run(), 0);
    this.startup.unref();
    this.timer = setInterval(() => void this.run(), BNET_PUBLIC_PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.startup);
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async run(): Promise<void> {
    try {
      await this.probe.run();
    } catch (error) {
      this.logger.error(`Public profile test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
