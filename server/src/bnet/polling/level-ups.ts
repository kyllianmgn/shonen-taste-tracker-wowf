/**
 * Events deduced from two successive Battle.net readings (docs/02 « Événements déduits »):
 * one LEVEL_UP per level gained, with a stable id so a repeated reading never duplicates it.
 */

export interface DeducedEvent {
  eventId: string;
  type: 'LEVEL_UP';
  at: Date;
  data: { level: number };
}

/** `bnet-<character_id>-<level>`, character_id being character.id. */
export function bnetLevelUpEventId(characterId: bigint, level: number): string {
  return `bnet-${characterId}-${level}`;
}

export function deduceLevelUps(characterId: bigint, from: number, to: number, at: Date): DeducedEvent[] {
  const events: DeducedEvent[] = [];
  for (let level = from + 1; level <= to; level++) {
    events.push({ eventId: bnetLevelUpEventId(characterId, level), type: 'LEVEL_UP', at, data: { level } });
  }
  return events;
}
