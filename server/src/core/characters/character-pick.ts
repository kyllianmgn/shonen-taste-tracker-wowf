import type { CharacterName, CharacterRole, OwnedCharacter } from './character.types';

/** Discord allows at most 25 autocomplete choices. */
const MAX_CHOICES = 25;

export const ROLE_LABELS: Record<CharacterRole, string> = {
  main: 'principal',
  alt: 'secondaire',
  untracked: 'non suivi',
};

/** Which characters each /perso subcommand offers. */
export type PickMode = 'principal' | 'retirer';

const fullName = (c: CharacterName) => `${c.firstName} ${c.surname}`;

/** « Prénom Nom (EU) · principal », the autocomplete label (also accepted as typed input). */
export function characterLabel(c: OwnedCharacter): string {
  return `${fullName(c)} (${c.region.toUpperCase()}) · ${ROLE_LABELS[c.role]}`;
}

/** Lower case, no accents, single spaces: for matching what a member types. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function offered(c: OwnedCharacter, mode: PickMode): boolean {
  return mode === 'principal' ? c.role !== 'main' : c.role !== 'untracked';
}

/** Autocomplete choices of the `perso` option; the value is the character id. */
export function characterChoices(
  characters: readonly OwnedCharacter[],
  mode: PickMode,
  typed: string,
): { name: string; value: string }[] {
  const query = fold(typed);
  return characters
    .filter((c) => offered(c, mode) && fold(characterLabel(c)).includes(query))
    .slice(0, MAX_CHOICES)
    .map((c) => ({ name: characterLabel(c), value: String(c.id) }));
}

/**
 * The member's character designated by the `perso` option: the id sent by the autocomplete,
 * or typed text (« Prénom Nom », « Prénom Nom (EU) » or the full label). Null when none or several match.
 */
export function resolveCharacterPick(input: string, characters: readonly OwnedCharacter[]): OwnedCharacter | null {
  const value = input.trim();
  if (/^\d+$/.test(value)) {
    const byId = characters.find((c) => String(c.id) === value);
    if (byId) return byId;
  }
  const query = fold(value);
  const matches = characters.filter((c) =>
    [fullName(c), `${fullName(c)} (${c.region})`, characterLabel(c)].some((form) => fold(form) === query),
  );
  return matches.length === 1 ? matches[0] : null;
}
