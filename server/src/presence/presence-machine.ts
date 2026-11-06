/**
 * Presence state machine of docs/02 « Présence et sessions » (table « Transitions »), pure and
 * clock-free: every input carries its own time, in milliseconds since the epoch. PresenceService
 * loads the player's state, runs `presenceTransition` and applies the returned effects.
 */

/** Time left to the app for its final sync after the game stops (docs/02, row 4). */
export const FINAL_SYNC_WAIT_MS = 90_000;
/** Client timestamps may run up to 5 min ahead of the server (docs/02 « Règles de validation »). */
export const CLOCK_SKEW_MS = 5 * 60_000;
/** Online while a running device was heard from less than this many heartbeat intervals ago. */
export const HEARTBEAT_TIMEOUT_FACTOR = 2.5;

/** `character_changed`: split on a SESSION_START of another character (row 3). */
export type EndReason = 'game_closed' | 'heartbeat_timeout' | 'character_changed';

export interface PresenceRules {
  heartbeatIntervalSec: number;
}

/** A non-revoked device of the player. */
export interface DeviceState {
  id: string;
  gameRunning: boolean;
  lastSeenAt: number | null;
}

export interface OpenSession {
  /** Null until a heartbeat or a sync names the character. */
  characterId: bigint | null;
  startedAt: number;
}

export interface PresenceState {
  /** The player's open game_session, if any (at most one). */
  session: OpenSession | null;
  /** Non-revoked devices, as stored before the input is applied. */
  devices: DeviceState[];
  /** When the last `gameRunning: false` heartbeat arrived, if known. */
  stoppedAt: number | null;
}

export type PresenceInput =
  | { kind: 'heartbeat'; deviceId: string; gameRunning: boolean; characterId: bigint | null; at: number }
  /** A snapshot stored by a sync (character.updated). */
  | { kind: 'snapshot'; characterId: bigint; capturedAt: number }
  /** A new SESSION_START event stored by a sync (event.recorded). */
  | { kind: 'session_start'; characterId: bigint; at: number; level: number | null }
  /** The minute job, or the end of the 90 s wait. */
  | { kind: 'tick'; at: number };

export type PresenceEffect =
  /** Close the open session, compute its recap, emit session.ended. */
  | { kind: 'close'; reason: EndReason; endedAt: number }
  /** Open a session, fill its start values, emit session.started. */
  | { kind: 'open'; characterId: bigint | null; startedAt: number; levelStart: number | null }
  /** Set the missing character of the open session and fill its start values. */
  | { kind: 'attach'; characterId: bigint }
  /** Refresh the end values of the open session from that character's last snapshot. */
  | { kind: 'update_end'; characterId: bigint }
  /** SESSION_START level: the start level is the lowest one seen (levels never go down). */
  | { kind: 'start_level'; level: number }
  /** Run a tick at that time (end of the wait for the final sync). */
  | { kind: 'schedule_close'; at: number };

export function isOnline(devices: readonly DeviceState[], now: number, rules: PresenceRules): boolean {
  const timeoutMs = HEARTBEAT_TIMEOUT_FACTOR * rules.heartbeatIntervalSec * 1_000;
  return devices.some((d) => d.gameRunning && d.lastSeenAt !== null && now - d.lastSeenAt < timeoutMs);
}

export function presenceTransition(state: PresenceState, input: PresenceInput, rules: PresenceRules): PresenceEffect[] {
  switch (input.kind) {
    case 'heartbeat':
      return input.gameRunning ? onRunning(state, input, rules) : onStopped(state, input, rules);
    case 'snapshot':
      return onSnapshot(state, input);
    case 'session_start':
      return onSessionStart(state, input);
    case 'tick':
      return onTick(state, input.at, rules);
  }
}

type Heartbeat = Extract<PresenceInput, { kind: 'heartbeat' }>;

/** Row 1. */
function onRunning(state: PresenceState, beat: Heartbeat, rules: PresenceRules): PresenceEffect[] {
  const open: PresenceEffect = { kind: 'open', characterId: beat.characterId, startedAt: beat.at, levelStart: null };
  const { session } = state;
  if (!session) return [open];
  if (!isOnline(state.devices, beat.at, rules)) return [closeLeftover(state, session), open];
  return session.characterId === null && beat.characterId !== null
    ? [{ kind: 'attach', characterId: beat.characterId }]
    : [];
}

/** Row 4, first half: the 90 s wait starts once no other device runs the game. */
function onStopped(state: PresenceState, beat: Heartbeat, rules: PresenceRules): PresenceEffect[] {
  if (!state.session) return [];
  const after = state.devices.map((d) =>
    d.id === beat.deviceId ? { ...d, gameRunning: false, lastSeenAt: beat.at } : d,
  );
  return isOnline(after, beat.at, rules) ? [] : [{ kind: 'schedule_close', at: beat.at + FINAL_SYNC_WAIT_MS }];
}

/** Row 2: other characters' snapshots ride along in every sync and are ignored. */
function onSnapshot(state: PresenceState, input: Extract<PresenceInput, { kind: 'snapshot' }>): PresenceEffect[] {
  const { session } = state;
  if (!session || !withinSession(session, input.capturedAt)) return [];
  if (session.characterId === null) {
    return [
      { kind: 'attach', characterId: input.characterId },
      { kind: 'update_end', characterId: input.characterId },
    ];
  }
  return session.characterId === input.characterId ? [{ kind: 'update_end', characterId: input.characterId }] : [];
}

/** Rows 2 and 3. */
function onSessionStart(
  state: PresenceState,
  input: Extract<PresenceInput, { kind: 'session_start' }>,
): PresenceEffect[] {
  const { session } = state;
  if (!session || !withinSession(session, input.at)) return [];
  const level: PresenceEffect[] = input.level === null ? [] : [{ kind: 'start_level', level: input.level }];

  if (session.characterId === input.characterId) return level;
  if (session.characterId === null) return [{ kind: 'attach', characterId: input.characterId }, ...level];
  // Another character logged in: the skew margin does not apply to a split.
  if (input.at <= session.startedAt) return [];
  return [
    { kind: 'close', reason: 'character_changed', endedAt: input.at },
    { kind: 'open', characterId: input.characterId, startedAt: input.at, levelStart: input.level },
  ];
}

/** Row 4, second half, and row 5. */
function onTick(state: PresenceState, now: number, rules: PresenceRules): PresenceEffect[] {
  const { session } = state;
  if (!session || isOnline(state.devices, now, rules)) return [];
  if (stoppedDuring(state, session) && now < state.stoppedAt! + FINAL_SYNC_WAIT_MS) return [];
  return [closeLeftover(state, session)];
}

/** Close of a session whose player is offline: stopped game, or silent devices. */
function closeLeftover(state: PresenceState, session: OpenSession): PresenceEffect {
  if (stoppedDuring(state, session)) return { kind: 'close', reason: 'game_closed', endedAt: state.stoppedAt! };
  const lastSeen = Math.max(session.startedAt, ...state.devices.map((d) => d.lastSeenAt ?? 0));
  return { kind: 'close', reason: 'heartbeat_timeout', endedAt: lastSeen };
}

function stoppedDuring(state: PresenceState, session: OpenSession): boolean {
  return state.stoppedAt !== null && state.stoppedAt >= session.startedAt;
}

function withinSession(session: OpenSession, at: number): boolean {
  return at >= session.startedAt - CLOCK_SKEW_MS;
}
