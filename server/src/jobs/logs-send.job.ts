import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { LogsPublisher } from '../discord/logs/logs-publisher';

/** How often the logs queues are checked: well under the 1.5 s pace per channel. */
export const LOGS_TICK_MS = 500;

/** Logs send queue job: sends the ready messages every 500 ms, and what is left on shutdown. */
@Injectable()
export class LogsSendJob implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly publisher: LogsPublisher) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.publisher.tick();
    }, LOGS_TICK_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.publisher.flush();
  }
}
