import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { BnetAccountPoller } from './bnet-account-poller.service';

/** docs/02 « Sources et rythme des relevés »: the account profile is read every 10 minutes. */
export const BNET_POLL_INTERVAL_MS = 10 * 60_000;

/** Runs BnetAccountPoller.pollAll on a timer; a pass never overlaps the previous one. */
@Injectable()
export class BnetPollingJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BnetPollingJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly poller: BnetAccountPoller) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), BNET_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.poller.pollAll();
    } catch (error) {
      this.logger.error(`Battle.net polling pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
