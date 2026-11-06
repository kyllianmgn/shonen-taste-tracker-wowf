import { systemClock, type Clock } from '../ingest/clock';

/** Time source of the presence engine (ticks, the 90 s wait), replaceable in tests. */
export const PRESENCE_CLOCK = Symbol('PRESENCE_CLOCK');

export const presenceClockProvider = { provide: PRESENCE_CLOCK, useValue: systemClock satisfies Clock };
