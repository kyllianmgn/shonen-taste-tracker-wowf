export interface WindowRule {
  limit: number;
  windowSec: number;
}

export type HitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

interface Entry {
  windowMs: number;
  /** Accepted hits, oldest first. */
  hits: number[];
}

/**
 * In-memory sliding-window log: at most `limit` accepted hits per key over the last `windowSec`.
 * One process serves the whole API (docs/02 « Périmètre et stack »), so memory is enough; budgets
 * reset on restart. Refused hits are not recorded. Idle keys are swept every `sweepEvery` hits.
 */
export class SlidingWindowLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly sweepEvery: number;
  private hitsSinceSweep = 0;

  constructor(opts: { sweepEvery?: number } = {}) {
    this.sweepEvery = opts.sweepEvery ?? 1_000;
  }

  hit(key: string, rule: WindowRule, now: number): HitResult {
    if (++this.hitsSinceSweep >= this.sweepEvery) this.sweep(now);

    const windowMs = rule.windowSec * 1_000;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { windowMs, hits: [] };
      this.entries.set(key, entry);
    }
    entry.windowMs = windowMs;
    while (entry.hits.length > 0 && entry.hits[0] <= now - windowMs) entry.hits.shift();

    if (entry.hits.length >= rule.limit) {
      const freeAt = entry.hits[entry.hits.length - rule.limit] + windowMs;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((freeAt - now) / 1_000)) };
    }
    entry.hits.push(now);
    return { allowed: true };
  }

  /** Number of keys currently tracked. */
  size(): number {
    return this.entries.size;
  }

  private sweep(now: number): void {
    this.hitsSinceSweep = 0;
    for (const [key, entry] of this.entries) {
      const last = entry.hits[entry.hits.length - 1];
      if (last === undefined || last <= now - entry.windowMs) this.entries.delete(key);
    }
  }
}
