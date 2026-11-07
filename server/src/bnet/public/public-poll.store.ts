import type { Region } from '../../common/config/config';
import type { CharacterRole } from '../../core/characters/character.types';
import type { SyncFlag } from '../../ingest/sync/sync-rules';
import type { PublicPollState, PublicReading } from './public-reading';

/** A character whose public profile is due for a reading. */
export interface PublicPollTarget {
  characterId: bigint;
  ownerId: string;
  region: Region;
  firstName: string;
  surname: string;
  /** Null before the first reading. */
  poll: PublicPollState | null;
}

/** What one 200 reading recorded, for the internal events emitted after commit. */
export interface AppliedPublicReading {
  characterId: bigint;
  ownerId: string;
  role: CharacterRole;
  snapshot: { id: bigint; level: number } | null;
  flags: SyncFlag[];
  events: Array<{ id: bigint; eventId: string; type: string; at: Date; data: Record<string, unknown> }>;
  /** The closed game_session of a deduced session end. */
  session: { id: bigint; endedAt: Date; levelStart: number | null; levelEnd: number | null } | null;
}

export interface ProbeCandidate {
  region: Region;
  firstName: string;
  surname: string;
}

/** Database side of the public profile readings (PrismaPublicPollStore; in memory in tests). */
export interface PublicPollStore {
  /**
   * Main and secondary characters of base-mode players (no active device), never read or due by
   * `now`, the most overdue first.
   */
  dueTargets(now: Date, limit: number): Promise<PublicPollTarget[]>;
  /** 304, 404 or failure: only the next reading time changes. */
  reschedule(characterId: bigint, nextPollAt: Date): Promise<void>;
  /**
   * Applies a 200 in one transaction: planPublicReading on the locked state, then the snapshot,
   * the LEVEL_UPs, the closed session and the poll row. Null when the character changed owner.
   */
  applyReading(target: PublicPollTarget, reading: PublicReading, now: Date): Promise<AppliedPublicReading | null>;
  /** A Battle.net-verified character of level 10+ for the daily test, the most recently updated. */
  probeCandidate(): Promise<ProbeCandidate | null>;
}

export const PUBLIC_POLL_STORE = Symbol('PUBLIC_POLL_STORE');
