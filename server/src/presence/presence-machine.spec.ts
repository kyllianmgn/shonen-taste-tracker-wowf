import {
  FINAL_SYNC_WAIT_MS,
  isOnline,
  presenceTransition,
  type DeviceState,
  type PresenceState,
} from './presence-machine';

const RULES = { heartbeatIntervalSec: 600 };
/** 2.5 × 600 s. */
const TIMEOUT_MS = 1_500_000;
const T = 1_793_900_000_000;
const MIN = 60_000;
const DAVINA = 1n;
const MORWEN = 2n;

const device = (over: Partial<DeviceState> = {}): DeviceState => ({
  id: 'pc',
  gameRunning: false,
  lastSeenAt: T,
  ...over,
});

const state = (over: Partial<PresenceState> = {}): PresenceState => ({
  session: null,
  devices: [device()],
  stoppedAt: null,
  ...over,
});

describe('isOnline', () => {
  it('is true when a device runs the game and was seen less than 2.5 × the interval ago', () => {
    expect(isOnline([device({ gameRunning: true, lastSeenAt: T - TIMEOUT_MS + 1 })], T, RULES)).toBe(true);
  });

  it('is false at exactly 2.5 × the interval', () => {
    expect(isOnline([device({ gameRunning: true, lastSeenAt: T - TIMEOUT_MS })], T, RULES)).toBe(false);
  });

  it('is false when the game is not running, or the device was never seen', () => {
    expect(isOnline([device({ gameRunning: false })], T, RULES)).toBe(false);
    expect(isOnline([device({ gameRunning: true, lastSeenAt: null })], T, RULES)).toBe(false);
    expect(isOnline([], T, RULES)).toBe(false);
  });

  it('is true when any one device is active', () => {
    const devices = [device({ id: 'a' }), device({ id: 'b', gameRunning: true, lastSeenAt: T - MIN })];
    expect(isOnline(devices, T, RULES)).toBe(true);
  });
});

describe('row 1 — heartbeat gameRunning: true while the player is offline', () => {
  const beat = (characterId: bigint | null = DAVINA, at = T) =>
    ({ kind: 'heartbeat', deviceId: 'pc', gameRunning: true, characterId, at }) as const;

  it('opens a session for lastCharacter', () => {
    expect(presenceTransition(state(), beat(), RULES)).toEqual([
      { kind: 'open', characterId: DAVINA, startedAt: T, levelStart: null },
    ]);
  });

  it('opens a session without character when lastCharacter is unknown', () => {
    expect(presenceTransition(state(), beat(null), RULES)).toEqual([
      { kind: 'open', characterId: null, startedAt: T, levelStart: null },
    ]);
  });

  it('first closes a session left open by heartbeats that stopped (timeout not handled yet)', () => {
    const s = state({
      session: { characterId: DAVINA, startedAt: T - 60 * MIN },
      devices: [device({ gameRunning: true, lastSeenAt: T - 30 * MIN })],
    });
    expect(presenceTransition(s, beat(), RULES)).toEqual([
      { kind: 'close', reason: 'heartbeat_timeout', endedAt: T - 30 * MIN },
      { kind: 'open', characterId: DAVINA, startedAt: T, levelStart: null },
    ]);
  });

  it('first closes a session that was waiting for its final sync (game restarted within 90 s)', () => {
    const s = state({ session: { characterId: DAVINA, startedAt: T - 60 * MIN }, stoppedAt: T - 30_000 });
    expect(presenceTransition(s, beat(), RULES)).toEqual([
      { kind: 'close', reason: 'game_closed', endedAt: T - 30_000 },
      { kind: 'open', characterId: DAVINA, startedAt: T, levelStart: null },
    ]);
  });

  it('does nothing more while the player is already online (periodic heartbeat, 2nd device)', () => {
    const s = state({
      session: { characterId: DAVINA, startedAt: T - 10 * MIN },
      devices: [device({ gameRunning: true, lastSeenAt: T })],
    });
    expect(presenceTransition(s, beat(), RULES)).toEqual([]);
  });

  it('fills the character of an online session that had none', () => {
    const s = state({
      session: { characterId: null, startedAt: T - 10 * MIN },
      devices: [device({ gameRunning: true, lastSeenAt: T })],
    });
    expect(presenceTransition(s, beat(DAVINA), RULES)).toEqual([{ kind: 'attach', characterId: DAVINA }]);
  });

  it('never switches the character of a session on a heartbeat (only SESSION_START does)', () => {
    const s = state({
      session: { characterId: DAVINA, startedAt: T - 10 * MIN },
      devices: [device({ gameRunning: true, lastSeenAt: T })],
    });
    expect(presenceTransition(s, beat(MORWEN), RULES)).toEqual([]);
  });

  it('opens a session when online without one (defensive)', () => {
    const s = state({ devices: [device({ gameRunning: true, lastSeenAt: T })] });
    expect(presenceTransition(s, beat(), RULES)).toEqual([
      { kind: 'open', characterId: DAVINA, startedAt: T, levelStart: null },
    ]);
  });
});

describe('row 2 — sync during an open session', () => {
  const open = (characterId: bigint | null) =>
    state({
      session: { characterId, startedAt: T },
      devices: [device({ gameRunning: true, lastSeenAt: T + 10 * MIN })],
    });
  const snapshot = (characterId: bigint, capturedAt = T + 20 * MIN) =>
    ({ kind: 'snapshot', characterId, capturedAt }) as const;
  const sessionStart = (characterId: bigint, at = T + MIN, level: number | null = 22) =>
    ({ kind: 'session_start', characterId, at, level }) as const;

  it('fills the missing character, then updates the end values', () => {
    expect(presenceTransition(open(null), snapshot(DAVINA), RULES)).toEqual([
      { kind: 'attach', characterId: DAVINA },
      { kind: 'update_end', characterId: DAVINA },
    ]);
  });

  it('updates the end values of the session character', () => {
    expect(presenceTransition(open(DAVINA), snapshot(DAVINA), RULES)).toEqual([
      { kind: 'update_end', characterId: DAVINA },
    ]);
  });

  it("ignores another character's snapshot (other characters ride along in every sync)", () => {
    expect(presenceTransition(open(DAVINA), snapshot(MORWEN), RULES)).toEqual([]);
  });

  it('ignores a snapshot captured before the session (offline queue emptied late)', () => {
    expect(presenceTransition(open(null), snapshot(DAVINA, T - 6 * MIN), RULES)).toEqual([]);
  });

  it('accepts a snapshot up to 5 min before the session start (client clock skew)', () => {
    expect(presenceTransition(open(DAVINA), snapshot(DAVINA, T - 4 * MIN), RULES)).toEqual([
      { kind: 'update_end', characterId: DAVINA },
    ]);
  });

  it('takes the start level from the SESSION_START of the session character', () => {
    expect(presenceTransition(open(DAVINA), sessionStart(DAVINA), RULES)).toEqual([
      { kind: 'start_level', level: 22 },
    ]);
  });

  it('fills the missing character from a SESSION_START', () => {
    expect(presenceTransition(open(null), sessionStart(DAVINA), RULES)).toEqual([
      { kind: 'attach', characterId: DAVINA },
      { kind: 'start_level', level: 22 },
    ]);
  });

  it('only attaches when the SESSION_START carries no level', () => {
    expect(presenceTransition(open(null), sessionStart(DAVINA, T + MIN, null), RULES)).toEqual([
      { kind: 'attach', characterId: DAVINA },
    ]);
  });

  it('does nothing without an open session', () => {
    expect(presenceTransition(state(), snapshot(DAVINA), RULES)).toEqual([]);
    expect(presenceTransition(state(), sessionStart(DAVINA), RULES)).toEqual([]);
  });
});

describe('row 3 — SESSION_START of another character during the session', () => {
  const open = state({
    session: { characterId: DAVINA, startedAt: T },
    devices: [device({ gameRunning: true, lastSeenAt: T + 30 * MIN })],
  });

  it('closes the current session and opens one for that character at the SESSION_START time', () => {
    const input = { kind: 'session_start', characterId: MORWEN, at: T + 40 * MIN, level: 12 } as const;
    expect(presenceTransition(open, input, RULES)).toEqual([
      { kind: 'close', reason: 'character_changed', endedAt: T + 40 * MIN },
      { kind: 'open', characterId: MORWEN, startedAt: T + 40 * MIN, levelStart: 12 },
    ]);
  });

  it('ignores a SESSION_START from before the session start (older play, late sync)', () => {
    const input = { kind: 'session_start', characterId: MORWEN, at: T - MIN, level: 12 } as const;
    expect(presenceTransition(open, input, RULES)).toEqual([]);
  });

  it('ignores an old SESSION_START of the session character too', () => {
    const input = { kind: 'session_start', characterId: DAVINA, at: T - 6 * MIN, level: 20 } as const;
    expect(presenceTransition(open, input, RULES)).toEqual([]);
  });
});

describe('row 4 — heartbeat gameRunning: false and no other active device', () => {
  const open = (devices: DeviceState[]) => state({ session: { characterId: DAVINA, startedAt: T - 60 * MIN }, devices });
  const stop = { kind: 'heartbeat', deviceId: 'pc', gameRunning: false, characterId: DAVINA, at: T } as const;

  it('waits 90 s for a final sync before closing', () => {
    const s = open([device({ gameRunning: true, lastSeenAt: T })]);
    expect(presenceTransition(s, stop, RULES)).toEqual([{ kind: 'schedule_close', at: T + FINAL_SYNC_WAIT_MS }]);
  });

  it('keeps the session open while another device still runs the game', () => {
    const s = open([
      device({ gameRunning: true, lastSeenAt: T }),
      device({ id: 'laptop', gameRunning: true, lastSeenAt: T - MIN }),
    ]);
    expect(presenceTransition(s, stop, RULES)).toEqual([]);
  });

  it('does nothing without an open session', () => {
    expect(presenceTransition(state(), stop, RULES)).toEqual([]);
  });

  describe('then, on the tick', () => {
    const closing = state({
      session: { characterId: DAVINA, startedAt: T - 60 * MIN },
      devices: [device({ gameRunning: false, lastSeenAt: T + 30_000 })],
      stoppedAt: T,
    });

    it('keeps waiting before 90 s (a final sync can still land)', () => {
      expect(presenceTransition(closing, { kind: 'tick', at: T + FINAL_SYNC_WAIT_MS - 1 }, RULES)).toEqual([]);
    });

    it('closes with game_closed at the stop time once 90 s have passed', () => {
      expect(presenceTransition(closing, { kind: 'tick', at: T + FINAL_SYNC_WAIT_MS }, RULES)).toEqual([
        { kind: 'close', reason: 'game_closed', endedAt: T },
      ]);
    });

    it('ignores a stop older than the session (it belongs to an earlier one)', () => {
      const s = { ...closing, stoppedAt: T - 61 * MIN, devices: [device({ gameRunning: true, lastSeenAt: T - 30 * MIN })] };
      expect(presenceTransition(s, { kind: 'tick', at: T }, RULES)).toEqual([
        { kind: 'close', reason: 'heartbeat_timeout', endedAt: T - 30 * MIN },
      ]);
    });
  });
});

describe('row 5 — no heartbeat for the expiry delay (job every minute)', () => {
  const session = { characterId: DAVINA, startedAt: T - 60 * MIN };

  it('closes with heartbeat_timeout at the last heartbeat', () => {
    const s = state({ session, devices: [device({ gameRunning: true, lastSeenAt: T - TIMEOUT_MS })] });
    expect(presenceTransition(s, { kind: 'tick', at: T }, RULES)).toEqual([
      { kind: 'close', reason: 'heartbeat_timeout', endedAt: T - TIMEOUT_MS },
    ]);
  });

  it('keeps the session while a heartbeat is younger than the expiry delay', () => {
    const s = state({ session, devices: [device({ gameRunning: true, lastSeenAt: T - TIMEOUT_MS + 1 })] });
    expect(presenceTransition(s, { kind: 'tick', at: T }, RULES)).toEqual([]);
  });

  it('never ends a session before it started', () => {
    const s = state({ session, devices: [device({ gameRunning: true, lastSeenAt: null })] });
    expect(presenceTransition(s, { kind: 'tick', at: T }, RULES)).toEqual([
      { kind: 'close', reason: 'heartbeat_timeout', endedAt: session.startedAt },
    ]);
  });

  it('does nothing without an open session', () => {
    expect(presenceTransition(state(), { kind: 'tick', at: T }, RULES)).toEqual([]);
  });
});
