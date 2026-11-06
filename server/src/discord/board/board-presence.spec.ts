import { boardPresence } from './board-presence';

const NOW = new Date('2026-11-06T12:00:00Z');
const HEARTBEAT_SEC = 600;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('boardPresence', () => {
  it('is offline and never seen without devices', () => {
    expect(boardPresence([], NOW, HEARTBEAT_SEC)).toEqual({ online: false, lastSeenAt: null });
  });

  it('is online with a running game and a heartbeat less than 2.5 intervals old', () => {
    const devices = [{ gameRunning: true, lastSeenAt: minutesAgo(24), revokedAt: null }];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC)).toEqual({ online: true, lastSeenAt: minutesAgo(24) });
  });

  it('is offline once the heartbeat is 2.5 intervals old', () => {
    const devices = [{ gameRunning: true, lastSeenAt: minutesAgo(25), revokedAt: null }];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC).online).toBe(false);
  });

  it('is offline when the game is closed, and shows the latest heartbeat of any device', () => {
    const devices = [
      { gameRunning: false, lastSeenAt: minutesAgo(1), revokedAt: null },
      { gameRunning: false, lastSeenAt: minutesAgo(90), revokedAt: null },
      { gameRunning: false, lastSeenAt: null, revokedAt: null },
    ];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC)).toEqual({ online: false, lastSeenAt: minutesAgo(1) });
  });

  it('ignores revoked devices for the status but keeps their last heartbeat', () => {
    const devices = [{ gameRunning: true, lastSeenAt: minutesAgo(1), revokedAt: minutesAgo(0) }];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC)).toEqual({ online: false, lastSeenAt: minutesAgo(1) });
  });
});
