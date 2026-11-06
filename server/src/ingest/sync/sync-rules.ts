import type { CharacterRole, TrackedRole } from '../../core/characters/character.types';

/**
 * Business rules of POST /v1/sync (docs/02 « Règles de validation »), as pure functions.
 * Times are Unix seconds, as in the contract; the clock is in milliseconds.
 */

/** `capturedAt` and `at` may be at most 5 minutes in the future. */
export const FUTURE_TOLERANCE_SEC = 300;
/** More than 5 levels gained between two snapshots less than 15 minutes apart is suspect. */
export const SUSPECT_JUMP_LEVELS = 5;
export const SUSPECT_JUMP_WINDOW_SEC = 900;

/** Flags returned in `results[].flags` and stored on snapshots and events. */
export type SyncFlag = 'future_timestamp' | 'level_above_cap' | 'regression' | 'suspect_level_jump';

/**
 * Checks that need no stored state. A non-empty result rejects the whole character: nothing of it
 * is stored, other characters of the payload are still processed.
 */
export function checkPayloadCharacter(
  character: { snapshot: { capturedAt: number; level: number }; events: readonly { at: number }[] },
  nowMs: number,
  levelCap: number,
): SyncFlag[] {
  const flags: SyncFlag[] = [];
  const inFuture = (sec: number) => sec * 1_000 > nowMs + FUTURE_TOLERANCE_SEC * 1_000;
  if (inFuture(character.snapshot.capturedAt) || character.events.some((e) => inFuture(e.at))) {
    flags.push('future_timestamp');
  }
  if (character.snapshot.level > levelCap) flags.push('level_above_cap');
  return flags;
}

export interface SnapshotPoint {
  capturedAt: number;
  level: number;
  playedTotal?: number | null;
}

export type SnapshotVerdict =
  | { action: 'store'; flags: SyncFlag[] }
  /** Not newer than the stored one: no new snapshot, no error. Events are still recorded. */
  | { action: 'ignore' }
  | { action: 'reject'; flags: SyncFlag[] };

/** Compares a received snapshot with the last stored one (null for a new character). */
export function judgeSnapshot(previous: SnapshotPoint | null, next: SnapshotPoint): SnapshotVerdict {
  if (!previous) return { action: 'store', flags: [] };
  if (next.capturedAt <= previous.capturedAt) return { action: 'ignore' };

  const playedDown =
    previous.playedTotal != null && next.playedTotal != null && next.playedTotal < previous.playedTotal;
  if (next.level < previous.level || playedDown) return { action: 'reject', flags: ['regression'] };

  const suspect =
    next.level - previous.level > SUSPECT_JUMP_LEVELS && next.capturedAt - previous.capturedAt < SUSPECT_JUMP_WINDOW_SEC;
  return { action: 'store', flags: suspect ? ['suspect_level_jump'] : [] };
}

/**
 * Role of a character auto-attached to the device owner, from the roles they already track:
 * the first free of main then alt, untracked beyond two (docs/03 « Décisions ouvertes »).
 */
export function assignRole(tracked: readonly TrackedRole[]): CharacterRole {
  if (!tracked.includes('main')) return 'main';
  if (!tracked.includes('alt')) return 'alt';
  return 'untracked';
}
