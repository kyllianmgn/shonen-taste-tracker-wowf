import type { CharacterRole } from '../../core/characters/character.types';
import type { BoardRest } from '../board/board-ports';
import type { LogPrivacy } from '../render/logs';

/**
 * The slices of Discord and of the database that the logs publisher needs. The adapters are
 * discord.js's REST client and prisma-logs.store.ts; tests use in-memory fakes (./testing).
 */

export const LOGS_STORE = Symbol('LOGS_STORE');

/** Subset of discord.js's `REST`: only posting messages. */
export type LogsRest = Pick<BoardRest, 'post'>;

/** A guild where a player's logs go: it has a logs channel and the player has a membership. */
export interface LogTarget {
  guildId: string;
  logsChannelId: string;
  levelAnnounceStep: number;
  logDeaths: boolean;
}

export interface LogCharacterInfo {
  firstName: string;
  surname: string;
  /** Current role: `untracked` characters are never shown. */
  role: CharacterRole;
  /** Level of the last snapshot, null without snapshot. */
  level: number | null;
  /** Last snapshot's `sex` is 3. */
  female: boolean;
}

/** What `claimEvent` needs to know about a game_event. */
export interface ClaimedEvent {
  /** game_event.id */
  id: bigint;
  characterId: bigint;
  type: string;
  /** LEVEL_UP only: the level, for the « once per level » rule. */
  level: number | null;
}

export interface LogsStore {
  targetsOfPlayer(discordUserId: string): Promise<LogTarget[]>;
  /** Everything visible when the player row does not exist. */
  privacyOf(discordUserId: string): Promise<LogPrivacy>;
  characterOf(characterId: bigint): Promise<LogCharacterInfo | null>;
  /**
   * Sets published_at if it is still null — and, for a LEVEL_UP, if no other LEVEL_UP of the same
   * character and level is published (the addon and Battle.net can both record one). false means
   * the event is, or counts as, already published: it must not be posted.
   */
  claimEvent(event: ClaimedEvent, now: Date): Promise<boolean>;
}
