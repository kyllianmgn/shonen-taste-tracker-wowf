import { APP_MODE_WINDOW_DAYS, playerMode } from './player-mode';

const NOW = new Date('2026-11-06T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('playerMode', () => {
  it('is base mode without any device', () => {
    expect(playerMode([], NOW)).toBe('base');
  });

  it('is app mode with a non-revoked device seen in the last 7 days', () => {
    expect(playerMode([{ lastSeenAt: daysAgo(6.9), revokedAt: null }], NOW)).toBe('app');
    expect(playerMode([{ lastSeenAt: daysAgo(APP_MODE_WINDOW_DAYS), revokedAt: null }], NOW)).toBe('app');
  });

  it('is base mode when every device is revoked, never seen or seen more than 7 days ago', () => {
    expect(
      playerMode(
        [
          { lastSeenAt: daysAgo(1), revokedAt: daysAgo(0.5) },
          { lastSeenAt: null, revokedAt: null },
          { lastSeenAt: daysAgo(7.01), revokedAt: null },
        ],
        NOW,
      ),
    ).toBe('base');
  });

  it('one active device is enough', () => {
    expect(
      playerMode(
        [
          { lastSeenAt: daysAgo(30), revokedAt: null },
          { lastSeenAt: daysAgo(0), revokedAt: null },
        ],
        NOW,
      ),
    ).toBe('app');
  });
});
