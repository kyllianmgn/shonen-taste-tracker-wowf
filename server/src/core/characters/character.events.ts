import type { TrackedRole } from './character.types';

/** Internal events of the characters service, emitted through EventEmitter2 after commit. */
export const CHARACTER_EVENTS = {
  tracked: 'character.tracked',
} as const;

/**
 * A character became main or alt while it was new, unowned or untracked (/perso ajouter,
 * /admin perso, /perso principal or the role menus on an untracked one). Role swaps between main
 * and alt emit nothing.
 */
export interface CharacterTrackedEvent {
  characterId: bigint;
  ownerId: string;
  role: TrackedRole;
  firstName: string;
  surname: string;
}
