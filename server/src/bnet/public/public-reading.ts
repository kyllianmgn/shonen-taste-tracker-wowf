import { isDeepStrictEqual } from 'node:util';
import { judgeSnapshot, type SyncFlag } from '../../ingest/sync/sync-rules';
import type { BnetPublicCharacter } from '../client';
import { publicPollIntervalMs } from './public-poll-interval';

/**
 * What a public profile reading changes (docs/02 « Fiche publique », « Événements déduits »). Pure:
 * the store loads the state under lock, asks for a plan, then writes it.
 */

/** The fields of the public profile docs/02 cites: level, equipment, `last_login_timestamp`. */
export interface PublicReading {
  level: number | null;
  /** Stored as is in `snapshot.detail.equipment`; the API is not documented. */
  equipment: unknown;
  lastLoginAt: Date | null;
  lastModified: string | null;
}

/** Row of bnet_public_poll, without the schedule. */
export interface PublicPollState {
  lastModified: string | null;
  lastLoginAt: Date | null;
  changedAt: Date | null;
}

export interface PublicPlanInput {
  /** Last snapshot of the character, whatever its source. */
  previous: { level: number; capturedAt: Date } | null;
  /** Equipment of the last `bnet_public` snapshot; undefined without one. */
  lastPublicEquipment: unknown;
  poll: PublicPollState | null;
  reading: PublicReading;
  now: Date;
}

export interface PublicPlan {
  snapshot: { level: number; equipment: unknown; flags: SyncFlag[] } | null;
  /** One LEVEL_UP per level in (from, to]. */
  levelUps: { from: number; to: number } | null;
  /** Session end deduced from `last_login_timestamp` moving forward. */
  sessionEnd: { endedAt: Date; levelStart: number | null; levelEnd: number | null } | null;
  poll: PublicPollState & { nextPollAt: Date };
}

/** Timestamps below this are taken as seconds (the API sends milliseconds, like the retail one). */
const SECONDS_LIMIT = 100_000_000_000;

export function readPublicCharacter(character: BnetPublicCharacter, lastModified?: string): PublicReading {
  const level = Number.isInteger(character.level) && (character.level as number) > 0 ? (character.level as number) : null;
  const raw = character.last_login_timestamp;
  const lastLoginAt =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? new Date(raw < SECONDS_LIMIT ? raw * 1_000 : raw) : null;
  return { level, equipment: character.equipment ?? null, lastLoginAt, lastModified: lastModified ?? null };
}

export function planPublicReading({ previous, lastPublicEquipment, poll, reading, now }: PublicPlanInput): PublicPlan {
  const snapshot = plannedSnapshot(previous, lastPublicEquipment, reading, now);
  const levelUps = snapshot && previous && snapshot.level > previous.level ? { from: previous.level, to: snapshot.level } : null;

  const storedLogin = poll?.lastLoginAt ?? null;
  const loginMoved = reading.lastLoginAt !== null && storedLogin !== null && reading.lastLoginAt > storedLogin;
  const sessionEnd = loginMoved
    ? {
        endedAt: reading.lastLoginAt!,
        levelStart: previous?.level ?? null,
        levelEnd: snapshot?.level ?? previous?.level ?? reading.level,
      }
    : null;

  const state: PublicPollState = {
    lastModified: reading.lastModified ?? poll?.lastModified ?? null,
    lastLoginAt: latest(storedLogin, reading.lastLoginAt),
    changedAt: snapshot ? now : (poll?.changedAt ?? null),
  };
  return { snapshot, levelUps, sessionEnd, poll: { ...state, nextPollAt: nextPollAt(state, now) } };
}

/** 304 or 404: nothing recorded, only the next reading is scheduled. */
export function planUnchanged(poll: PublicPollState | null, now: Date): Date {
  return nextPollAt(poll ?? { lastModified: null, lastLoginAt: null, changedAt: null }, now);
}

function plannedSnapshot(
  previous: PublicPlanInput['previous'],
  lastPublicEquipment: unknown,
  reading: PublicReading,
  now: Date,
): PublicPlan['snapshot'] {
  const { level, equipment } = reading;
  if (level === null) return null;
  if (previous) {
    // Lower than what is stored: an older profile (a /sync may be ahead of Battle.net).
    if (level < previous.level) return null;
    const equipmentChanged =
      equipment !== null && (lastPublicEquipment === undefined || !isDeepStrictEqual(equipment, lastPublicEquipment));
    if (level === previous.level && !equipmentChanged) return null;
  }
  const seconds = (d: Date) => Math.floor(d.getTime() / 1_000);
  const verdict = judgeSnapshot(previous && { capturedAt: seconds(previous.capturedAt), level: previous.level }, {
    capturedAt: seconds(now),
    level,
  });
  return verdict.action === 'store' ? { level, equipment, flags: verdict.flags } : null;
}

function nextPollAt(state: PublicPollState, now: Date): Date {
  return new Date(now.getTime() + publicPollIntervalMs(state, now));
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}
