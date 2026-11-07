import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { BnetPublicPoller } from '../bnet/public/bnet-public-poller.service';

/**
 * How often due characters are looked for. Each character has its own rhythm (10 min, 1 h or
 * 6 h, docs/02 « Sources et rythme des relevés »); the tick only bounds the delay.
 */
export const BNET_PUBLIC_POLL_TICK_MS = 60_000;

/** Runs BnetPublicPoller.pollDue on a timer; a pass never overlaps the previous one. */
@Injectable()
export class BnetPublicPollJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BnetPublicPollJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly poller: BnetPublicPoller) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), BNET_PUBLIC_POLL_TICK_MS);
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
      await this.poller.pollDue();
    } catch (error) {
      this.logger.error(`Public profile polling pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
