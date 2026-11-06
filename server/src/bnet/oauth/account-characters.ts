import { normalizeCharacterName } from '../../core/characters/character-name';
import type { BnetAccountCharacter, BnetAccountProfile } from '../client';

/**
 * Characters of an account profile (docs/02 « Flux » step 4). Only the fields cited in docs/02 are
 * read; the Forever API is not documented, so every field is checked before use.
 */

export type Faction = 'Alliance' | 'Horde' | 'Neutral';

export interface AccountCharacter {
  firstName: string;
  surname: string;
  level: number | null;
  classFile: string | null;
  raceFile: string | null;
  faction: Faction | null;
  /** From the protected_character link, the only place the realm appears. */
  realmId: number | null;
}

/**
 * Classic class and race ids, as the game's `classFile` / `raceFile` tokens. Unknown ids (the two
 * Skyborne races, whose ids are not known yet) stay null rather than being guessed.
 */
const CLASS_FILES: Record<number, string> = {
  1: 'WARRIOR',
  2: 'PALADIN',
  3: 'HUNTER',
  4: 'ROGUE',
  5: 'PRIEST',
  7: 'SHAMAN',
  8: 'MAGE',
  9: 'WARLOCK',
  11: 'DRUID',
};
const RACE_FILES: Record<number, string> = {
  1: 'Human',
  2: 'Orc',
  3: 'Dwarf',
  4: 'NightElf',
  5: 'Scourge',
  6: 'Tauren',
  7: 'Gnome',
  8: 'Troll',
};
const FACTIONS: Record<string, Faction> = { ALLIANCE: 'Alliance', HORDE: 'Horde', NEUTRAL: 'Neutral' };

const PROTECTED_CHARACTER = /\/protected-character\/(\d+)-(\d+)(?:[?#]|$)/;

export function realmIdFromHref(href: string): number | null {
  const match = PROTECTED_CHARACTER.exec(href);
  return match ? Number(match[1]) : null;
}

/** Every character of every wow account, one per name (case-insensitive), invalid names skipped. */
export function accountCharacters(profile: BnetAccountProfile): AccountCharacter[] {
  const seen = new Set<string>();
  const result: AccountCharacter[] = [];
  for (const account of profile.wow_accounts ?? []) {
    for (const raw of account?.characters ?? []) {
      const character = read(raw);
      if (!character) continue;
      const key = `${character.firstName}\u0000${character.surname}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(character);
    }
  }
  return result;
}

function read(raw: Partial<BnetAccountCharacter> | null | undefined): AccountCharacter | null {
  if (!raw || typeof raw.name !== 'string' || typeof raw.surname !== 'string') return null;
  const firstName = normalizeCharacterName(raw.name);
  const surname = normalizeCharacterName(raw.surname);
  if (!firstName || !surname) return null;

  const id = (ref: unknown) => (typeof (ref as { id?: unknown })?.id === 'number' ? (ref as { id: number }).id : -1);
  const href = (raw.protected_character as { href?: unknown } | undefined)?.href;
  const factionType = (raw.faction as { type?: unknown } | undefined)?.type;
  return {
    firstName,
    surname,
    level: typeof raw.level === 'number' && Number.isInteger(raw.level) && raw.level > 0 ? raw.level : null,
    classFile: CLASS_FILES[id(raw.playable_class)] ?? null,
    raceFile: RACE_FILES[id(raw.playable_race)] ?? null,
    faction: typeof factionType === 'string' ? (FACTIONS[factionType] ?? null) : null,
    realmId: typeof href === 'string' ? realmIdFromHref(href) : null,
  };
}
