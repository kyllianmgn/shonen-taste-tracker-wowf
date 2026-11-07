import type { CharacterRole } from '../../core/characters/character.types';
import { renderDeathLog, renderDungeonEnterLog, renderGuildJoinLog, renderLevel60Log, renderLevelUpLog, type LogCharacter } from '../render/logs';

/** Filters of docs/02 « Logs », pure. */

/** Events received this long after their `at` (offline queue emptied late) are never published. */
export const LOG_MAX_DELAY_MS = 24 * 3_600_000;
const MAX_LEVEL = 60;

/** Flagged events, untracked characters and events received over 24 h late stay unpublished. */
export function isPublishableEvent(
  event: { at: Date; flags: readonly string[]; role: CharacterRole },
  receivedAt: Date,
): boolean {
  if (event.flags.length > 0 || event.role === 'untracked') return false;
  return receivedAt.getTime() - event.at.getTime() <= LOG_MAX_DELAY_MS;
}

/** `level % level_announce_step == 0`; the 60 is always announced. */
export function shouldAnnounceLevel(level: number, step: number): boolean {
  return level === MAX_LEVEL || step <= 1 || level % step === 0;
}

/** The `level` of an event's data, when it is a valid character level. */
export function eventLevel(data: Record<string, unknown>): number | null {
  const level = data.level;
  return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL ? level : null;
}

const nonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export interface EventLogContext {
  character: LogCharacter;
  female: boolean;
  hideZone: boolean;
  /** guild_config of the logs channel. */
  levelAnnounceStep: number;
  logDeaths: boolean;
}

/** The line a game event posts in one guild's logs channel, or null when it posts nothing there. */
export function eventLogLine(event: { type: string; data: Record<string, unknown> }, ctx: EventLogContext): string | null {
  const { character } = ctx;
  switch (event.type) {
    case 'LEVEL_UP': {
      const level = eventLevel(event.data);
      if (level === null || !shouldAnnounceLevel(level, ctx.levelAnnounceStep)) return null;
      const playedTotal = nonNegative(event.data.playedTotal);
      return level === MAX_LEVEL
        ? renderLevel60Log({ character, playedTotal })
        : renderLevelUpLog({ character, level, playedTotal });
    }
    case 'DEATH':
      if (!ctx.logDeaths) return null;
      return renderDeathLog({
        character,
        female: ctx.female,
        level: eventLevel(event.data),
        zone: text(event.data.zone),
        hideZone: ctx.hideZone,
      });
    case 'DUNGEON_ENTER': {
      // The instance is where the character is: without it the line says nothing, so hide_zone drops it.
      const instance = text(event.data.instanceName);
      return instance && !ctx.hideZone ? renderDungeonEnterLog({ character, instance }) : null;
    }
    case 'GUILD_CHANGE': {
      const guild = text(event.data.to);
      return guild ? renderGuildJoinLog({ character, guild }) : null;
    }
    default:
      return null;
  }
}
