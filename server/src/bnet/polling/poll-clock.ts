/** Time source of the Battle.net polling job (token expiry, snapshot time), replaceable in tests. */
export interface PollClock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const BNET_POLL_CLOCK = Symbol('BNET_POLL_CLOCK');

export const systemPollClock: PollClock = { now: () => Date.now() };
