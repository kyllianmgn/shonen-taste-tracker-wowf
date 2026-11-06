import { REGIONS, type Region } from './character.types';

/** 2 to 12 letters (docs/00 « Deux noms obligatoires », contract minLength/maxLength). */
const NAME = /^\p{L}{2,12}$/u;

/**
 * Normalizes a typed first name or surname: NFC, trimmed, first letter upper case and the rest
 * lower case, as the game writes names. Returns null when it is not 2-12 letters.
 * Lookups stay case-insensitive anyway (index on lower(first_name), lower(surname)).
 */
export function normalizeCharacterName(raw: string): string | null {
  const name = raw.normalize('NFC').trim();
  if (!NAME.test(name)) return null;
  const [first, ...rest] = Array.from(name);
  return first.toUpperCase() + rest.join('').toLowerCase();
}

/** Region option of /perso ajouter: EU when omitted, null when unknown. */
export function parseRegion(raw: string | null | undefined): Region | null {
  if (raw === null || raw === undefined) return 'eu';
  const region = raw.toLowerCase();
  return (REGIONS as readonly string[]).includes(region) ? (region as Region) : null;
}
