/** Session recap of docs/02 « Récap de session », computed when a session closes. Pure. */

/** Shorter sessions without any change are closed without a log (game launched and closed). */
export const QUIET_SESSION_MAX_SEC = 120;

export interface RecapInput {
  startedAt: Date;
  endedAt: Date;
  levelStart: number | null;
  levelEnd: number | null;
  moneyStart: bigint | null;
  moneyEnd: bigint | null;
  playedStart: number | null;
  playedEnd: number | null;
  /** Zone and sub-zone of the last snapshot of the session. */
  endZone: string | null;
  endSubZone: string | null;
  /** DEATH events of the session character during the session. */
  deaths: number;
}

export interface SessionRecap {
  durationSec: number;
  levelStart: number | null;
  levelEnd: number | null;
  /** level_end - level_start; null when either is unknown. */
  levelsGained: number | null;
  /** Copper won (positive) or lost (negative); null when either end is unknown. */
  moneyDelta: number | null;
  /** played_end - played_start, in seconds. */
  playedAddedSec: number | null;
  /** The log example « fin à Darkshire » is a sub-zone; the renderer picks. */
  endZone: string | null;
  endSubZone: string | null;
  deaths: number;
}

const delta = (start: number | null, end: number | null): number | null =>
  start === null || end === null ? null : end - start;

export function buildRecap(input: RecapInput): SessionRecap {
  const money = (v: bigint | null) => (v === null ? null : Number(v));
  return {
    durationSec: Math.max(0, Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 1_000)),
    levelStart: input.levelStart,
    levelEnd: input.levelEnd,
    levelsGained: delta(input.levelStart, input.levelEnd),
    moneyDelta: delta(money(input.moneyStart), money(input.moneyEnd)),
    playedAddedSec: delta(input.playedStart, input.playedEnd),
    endZone: input.endZone,
    endSubZone: input.endSubZone,
    deaths: input.deaths,
  };
}

/** Under 2 min with no level, no money change and no death: no log. Played time alone is not a change. */
export function isQuietSession(recap: SessionRecap): boolean {
  const changed = (recap.levelsGained ?? 0) !== 0 || (recap.moneyDelta ?? 0) !== 0 || recap.deaths > 0;
  return recap.durationSec < QUIET_SESSION_MAX_SEC && !changed;
}

export interface SnapshotValues {
  level: number;
  money: bigint | null;
  playedTotal: number | null;
}

export interface StartValues {
  levelStart: number | null;
  moneyStart: bigint | null;
  playedStart: number | null;
}

/**
 * Start values of a session: the character's last snapshot stored before the session (the
 * SavedVariables are only written at logout, so the session's own first snapshot is often its
 * end state), else the first snapshot of the session. A SESSION_START level refines the level.
 */
export function startValues(input: { baseline: SnapshotValues | null; first: SnapshotValues | null }): StartValues {
  const from = input.baseline ?? input.first;
  return {
    levelStart: from?.level ?? null,
    moneyStart: from?.money ?? null,
    playedStart: from?.playedTotal ?? null,
  };
}
