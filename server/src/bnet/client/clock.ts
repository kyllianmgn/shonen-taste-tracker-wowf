import { setTimeout as delay } from 'node:timers/promises';

/** Time source of the Battle.net client, injectable so tests never wait for real. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: async (ms) => {
    await delay(ms);
  },
};
