import { baseModeSeenAt, boardPresence } from './board-presence';

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

  it('counts the latest data received in « vu » when given', () => {
    const devices = [{ gameRunning: false, lastSeenAt: minutesAgo(90), revokedAt: null }];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC, minutesAgo(30)).lastSeenAt).toEqual(minutesAgo(30));
    expect(boardPresence(devices, NOW, HEARTBEAT_SEC, minutesAgo(120)).lastSeenAt).toEqual(minutesAgo(90));
    expect(boardPresence([], NOW, HEARTBEAT_SEC, minutesAgo(30))).toEqual({ online: false, lastSeenAt: minutesAgo(30) });
  });

  it('ignores revoked devices for the status but keeps their last heartbeat', () => {
    const devices = [{ gameRunning: true, lastSeenAt: minutesAgo(1), revokedAt: minutesAgo(0) }];

    expect(boardPresence(devices, NOW, HEARTBEAT_SEC)).toEqual({ online: false, lastSeenAt: minutesAgo(1) });
  });
});

describe('baseModeSeenAt', () => {
  it('is null without any data', () => {
    expect(baseModeSeenAt([])).toBeNull();
    expect(baseModeSeenAt([{ snapshot: null, lastLoginAt: null }])).toBeNull();
  });

  it('uses the last snapshot received', () => {
    const seen = baseModeSeenAt([
      { snapshot: { source: 'bnet_account', receivedAt: minutesAgo(40) }, lastLoginAt: null },
      { snapshot: { source: 'manual', receivedAt: minutesAgo(20) }, lastLoginAt: null },
    ]);
    expect(seen).toEqual(minutesAgo(20));
  });

  it('prefers last_login_timestamp to the time a public profile snapshot was read', () => {
    const seen = baseModeSeenAt([{ snapshot: { source: 'bnet_public', receivedAt: minutesAgo(5) }, lastLoginAt: minutesAgo(50) }]);
    expect(seen).toEqual(minutesAgo(50));
  });

  it('keeps a more recent /sync over last_login_timestamp', () => {
    const seen = baseModeSeenAt([{ snapshot: { source: 'manual', receivedAt: minutesAgo(5) }, lastLoginAt: minutesAgo(50) }]);
    expect(seen).toEqual(minutesAgo(5));
  });

  it('falls back to a public profile snapshot without last_login_timestamp', () => {
    const seen = baseModeSeenAt([{ snapshot: { source: 'bnet_public', receivedAt: minutesAgo(5) }, lastLoginAt: null }]);
    expect(seen).toEqual(minutesAgo(5));
  });
});
