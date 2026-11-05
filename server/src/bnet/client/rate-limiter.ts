import type { Clock } from './clock';

export interface RateLimits {
  perSecond: number;
  perHour: number;
}

/** Blizzard API limits (docs/02 « Fiche publique » : 100 requêtes/s et 36 000/h). */
export const BNET_RATE_LIMITS: RateLimits = { perSecond: 100, perHour: 36_000 };

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;

/**
 * FIFO queue with two sliding windows. Each `acquire` resolves when one more request may start;
 * `pauseUntil` holds the whole queue, e.g. after a 429.
 */
export class RateLimiter {
  private readonly starts: number[] = [];
  private tail: Promise<void> = Promise.resolve();
  private pausedUntil = 0;

  constructor(
    private readonly clock: Clock,
    private readonly limits: RateLimits = BNET_RATE_LIMITS,
  ) {}

  acquire(): Promise<void> {
    const turn = this.tail.then(() => this.waitForSlot());
    this.tail = turn;
    return turn;
  }

  pauseUntil(time: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, time);
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      while (this.starts.length > 0 && this.starts[0] <= now - HOUR_MS) this.starts.shift();

      const readyAt = Math.max(this.pausedUntil, this.nextFreeSlot(now));
      if (readyAt <= now) {
        this.starts.push(now);
        return;
      }
      await this.clock.sleep(readyAt - now);
    }
  }

  /** Earliest time at which both windows have room, given the starts of the last hour. */
  private nextFreeSlot(now: number): number {
    let ready = now;
    const count = this.starts.length;
    if (count >= this.limits.perHour) {
      ready = Math.max(ready, this.starts[count - this.limits.perHour] + HOUR_MS);
    }
    if (count >= this.limits.perSecond) {
      const oldestInWindow = this.starts[count - this.limits.perSecond];
      if (oldestInWindow > now - SECOND_MS) ready = Math.max(ready, oldestInWindow + SECOND_MS);
    }
    return ready;
  }
}
