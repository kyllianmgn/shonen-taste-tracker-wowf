import type { Prisma } from '../../generated/prisma/client';
import type { SyncFlag } from '../../ingest/sync/sync-rules';
import { deduceLevelUps } from './level-ups';

export interface RecordedLevelUp {
  id: bigint;
  eventId: string;
  type: string;
  at: Date;
  data: Record<string, unknown>;
}

/**
 * Stores one LEVEL_UP per level gained, `bnet-<character_id>-<level>` (docs/02 « Événements
 * déduits »), inside the caller's transaction. Levels the addon already reported (a /sync carrying
 * its own LEVEL_UP) are skipped, so a level is never deduced twice. Shared by the account (S-18)
 * and public profile (S-20) readings.
 */
export async function recordLevelUps(
  tx: Prisma.TransactionClient,
  characterId: bigint,
  from: number,
  to: number,
  at: Date,
  flags: SyncFlag[],
): Promise<RecordedLevelUp[]> {
  const known = await tx.gameEvent.findMany({ where: { characterId, type: 'LEVEL_UP' }, select: { data: true } });
  const reported = new Set(known.map((e) => (e.data as { level?: unknown } | null)?.level).filter((l) => typeof l === 'number'));
  const deduced = deduceLevelUps(characterId, from, to, at).filter((e) => !reported.has(e.data.level));
  if (deduced.length === 0) return [];
  const inserted = await tx.gameEvent.createManyAndReturn({
    data: deduced.map((e) => ({ characterId, eventId: e.eventId, type: e.type, at: e.at, data: e.data, flags })),
    skipDuplicates: true,
    select: { id: true, eventId: true, type: true, at: true, data: true },
  });
  const order = new Map(deduced.map((e, i) => [e.eventId, i] as const));
  return inserted
    .sort((a, b) => order.get(a.eventId)! - order.get(b.eventId)!)
    .map((e) => ({ ...e, data: e.data as Record<string, unknown> }));
}
