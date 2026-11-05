import type { Clock } from '../clock';

/** Test clock: `sleep` advances time instantly, so waits are observable without real delays. */
export class FakeClock implements Clock {
  private current: number;
  readonly sleeps: number[] = [];

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.current += ms;
    return Promise.resolve();
  }
}
