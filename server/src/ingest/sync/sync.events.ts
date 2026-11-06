import type { CharacterRole } from '../../core/characters/character.types';
import type { SyncFlag } from './sync-rules';

/**
 * Internal events emitted by the sync ingestion (docs/02 « Modules »), through EventEmitter2.
 * They are emitted after the character's transaction is committed; `discord` consumes them
 * with `@OnEvent(SYNC_EVENTS.…)`.
 */
export const SYNC_EVENTS = {
  characterUpdated: 'character.updated',
  eventRecorded: 'event.recorded',
} as const;

/** Where a snapshot comes from (snapshot.source). */
export type SnapshotSource = 'app' | 'manual' | 'bnet_account' | 'bnet_public';

/** A new snapshot was stored: the board may need a redraw. */
export interface CharacterUpdatedEvent {
  characterId: bigint;
  ownerId: string;
  /** `untracked` characters are stored but never shown. */
  role: CharacterRole;
  snapshotId: bigint;
  level: number;
  source: SnapshotSource;
  flags: SyncFlag[];
}

/** A game event was stored for the first time (duplicates emit nothing). */
export interface EventRecordedEvent {
  /** game_event.id */
  id: bigint;
  characterId: bigint;
  ownerId: string;
  role: CharacterRole;
  /** Id given by the addon. */
  eventId: string;
  type: string;
  at: Date;
  data: Record<string, unknown>;
  source: SnapshotSource;
  /** Non-empty (e.g. `suspect_level_jump`): recorded, never published in Discord. */
  flags: SyncFlag[];
}
