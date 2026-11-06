import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BoardPublisher } from '../discord/board/board-publisher';

/** How often the marked boards are checked (docs/02 « Debounce »). */
export const BOARD_TICK_MS = 5000;

/** Board debounce job: redraws every board at startup, then the marked ones every 5 s. */
@Injectable()
export class BoardRedrawJob implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> = Promise.resolve();

  constructor(private readonly publisher: BoardPublisher) {}

  onApplicationBootstrap(): void {
    this.publisher.markAllDirty();
    this.timer = setInterval(() => {
      this.current = this.publisher.tick();
    }, BOARD_TICK_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.current;
  }
}
