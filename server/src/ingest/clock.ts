/** Time source of the ingest module (code expiry, rate limits, last_seen_at), replaceable in tests. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const INGEST_CLOCK = Symbol('INGEST_CLOCK');

export const systemClock: Clock = { now: () => Date.now() };
