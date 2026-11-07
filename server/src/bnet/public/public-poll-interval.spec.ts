import {
  PUBLIC_POLL_ACTIVE_MS,
  PUBLIC_POLL_IDLE_MS,
  PUBLIC_POLL_QUIET_MS,
  publicPollIntervalMs,
} from './public-poll-interval';

const NOW = new Date('2026-11-07T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

describe('publicPollIntervalMs', () => {
  it('uses the docs/02 rhythm: 10 min, 1 h, 6 h', () => {
    expect(PUBLIC_POLL_ACTIVE_MS).toBe(10 * 60_000);
    expect(PUBLIC_POLL_QUIET_MS).toBe(3_600_000);
    expect(PUBLIC_POLL_IDLE_MS).toBe(6 * 3_600_000);
  });

  it('polls every 10 min when the character changed in the last 24 h', () => {
    expect(publicPollIntervalMs({ changedAt: hoursAgo(1), lastLoginAt: daysAgo(30) }, NOW)).toBe(PUBLIC_POLL_ACTIVE_MS);
    expect(publicPollIntervalMs({ changedAt: hoursAgo(23.9), lastLoginAt: null }, NOW)).toBe(PUBLIC_POLL_ACTIVE_MS);
  });

  it('counts a recent login as a change', () => {
    expect(publicPollIntervalMs({ changedAt: daysAgo(10), lastLoginAt: hoursAgo(2) }, NOW)).toBe(PUBLIC_POLL_ACTIVE_MS);
  });

  it('polls every hour when nothing changed for a day but the character played this week', () => {
    expect(publicPollIntervalMs({ changedAt: hoursAgo(25), lastLoginAt: null }, NOW)).toBe(PUBLIC_POLL_QUIET_MS);
    expect(publicPollIntervalMs({ changedAt: daysAgo(10), lastLoginAt: daysAgo(7) }, NOW)).toBe(PUBLIC_POLL_QUIET_MS);
  });

  it('polls every 6 h when the character has been inactive for more than 7 days', () => {
    expect(publicPollIntervalMs({ changedAt: daysAgo(8), lastLoginAt: daysAgo(7.5) }, NOW)).toBe(PUBLIC_POLL_IDLE_MS);
    expect(publicPollIntervalMs({ changedAt: null, lastLoginAt: daysAgo(30) }, NOW)).toBe(PUBLIC_POLL_IDLE_MS);
  });

  it('polls every hour when nothing is known yet', () => {
    expect(publicPollIntervalMs({ changedAt: null, lastLoginAt: null }, NOW)).toBe(PUBLIC_POLL_QUIET_MS);
  });
});
