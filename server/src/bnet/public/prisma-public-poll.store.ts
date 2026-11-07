import { Injectable } from '@nestjs/common';
import { REGIONS, type Region } from '../../common/config/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { retryOnUniqueViolation } from '../../common/prisma/unique-violation';
import type { CharacterRole } from '../../core/characters/character.types';
import { appModeSince } from '../../core/players/player-mode';
import type { Prisma } from '../../generated/prisma/client';
import { recordLevelUps } from '../polling/record-level-ups';
import type { AppliedPublicReading, ProbeCandidate, PublicPollStore, PublicPollTarget } from './public-poll.store';
import { planPublicReading, type PublicReading } from './public-reading';

const SOURCE = 'bnet_public';
const PROBE_MIN_LEVEL = 10;

const isRegion = (value: string): value is Region => (REGIONS as readonly string[]).includes(value);
const roleOf = (role: string | null): CharacterRole => (role === 'main' || role === 'alt' ? role : 'untracked');

/** PublicPollStore on PostgreSQL: bnet_public_poll, snapshot, game_event, game_session. */
@Injectable()
export class PrismaPublicPollStore implements PublicPollStore {
  constructor(private readonly prisma: PrismaService) {}

  async dueTargets(now: Date, limit: number): Promise<PublicPollTarget[]> {
    const rows = await this.prisma.character.findMany({
      where: {
        role: { in: ['main', 'alt'] },
        // Base mode only: the app is more precise (docs/02 « Mode de base »).
        owner: { is: { devices: { none: { revokedAt: null, lastSeenAt: { gte: appModeSince(now) } } } } },
        OR: [{ bnetPublicPoll: { is: null } }, { bnetPublicPoll: { is: { nextPollAt: { lte: now } } } }],
      },
      select: {
        id: true,
        ownerId: true,
        region: true,
        firstName: true,
        surname: true,
        bnetPublicPoll: { select: { lastModified: true, lastLoginAt: true, changedAt: true } },
      },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows
      .filter((r) => r.ownerId !== null && isRegion(r.region))
      .map((r) => ({
        characterId: r.id,
        ownerId: r.ownerId!,
        region: r.region as Region,
        firstName: r.firstName,
        surname: r.surname,
        poll: r.bnetPublicPoll,
      }));
  }

  async reschedule(characterId: bigint, nextPollAt: Date): Promise<void> {
    await this.prisma.bnetPublicPoll.upsert({
      where: { characterId },
      create: { characterId, nextPollAt },
      update: { nextPollAt },
    });
  }

  applyReading(target: PublicPollTarget, reading: PublicReading, now: Date): Promise<AppliedPublicReading | null> {
    return retryOnUniqueViolation(() => this.prisma.$transaction((tx) => this.apply(tx, target, reading, now)));
  }

  private async apply(
    tx: Prisma.TransactionClient,
    target: PublicPollTarget,
    reading: PublicReading,
    now: Date,
  ): Promise<AppliedPublicReading | null> {
    const { characterId, ownerId } = target;
    // Same lock order as SyncService and the account readings: the owner's row, then the character.
    await tx.$queryRaw`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ role: string | null; lastSnapshotId: bigint | null }>>`
      SELECT role, last_snapshot_id AS "lastSnapshotId"
      FROM "character"
      WHERE id = ${characterId} AND owner_id = ${ownerId}
      FOR UPDATE`;
    const character = rows[0];
    if (!character) return null;

    const previous = character.lastSnapshotId
      ? await tx.snapshot.findUnique({ where: { id: character.lastSnapshotId }, select: { level: true, capturedAt: true } })
      : null;
    const lastPublic = await tx.snapshot.findFirst({
      where: { characterId, source: SOURCE },
      orderBy: { id: 'desc' },
      select: { detail: true },
    });
    const poll = await tx.bnetPublicPoll.findUnique({
      where: { characterId },
      select: { lastModified: true, lastLoginAt: true, changedAt: true },
    });

    const plan = planPublicReading({
      previous,
      lastPublicEquipment: lastPublic ? ((lastPublic.detail as { equipment?: unknown } | null)?.equipment ?? null) : undefined,
      poll,
      reading,
      now,
    });

    let snapshot: AppliedPublicReading['snapshot'] = null;
    const flags = plan.snapshot?.flags ?? [];
    if (plan.snapshot) {
      const detail = (plan.snapshot.equipment === null ? {} : { equipment: plan.snapshot.equipment }) as Prisma.InputJsonObject;
      snapshot = await tx.snapshot.create({
        data: { characterId, capturedAt: now, level: plan.snapshot.level, detail, source: SOURCE, flags },
        select: { id: true, level: true },
      });
      await tx.character.update({ where: { id: characterId }, data: { lastSnapshotId: snapshot.id } });
    }

    const events = plan.levelUps
      ? await recordLevelUps(tx, characterId, plan.levelUps.from, plan.levelUps.to, now, flags)
      : [];

    let session: AppliedPublicReading['session'] = null;
    if (plan.sessionEnd) {
      const { endedAt, levelStart, levelEnd } = plan.sessionEnd;
      const created = await tx.gameSession.create({
        data: { ownerId, characterId, startedAt: endedAt, endedAt, endReason: 'bnet_logout', levelStart, levelEnd },
        select: { id: true },
      });
      session = { id: created.id, endedAt, levelStart, levelEnd };
    }

    await tx.bnetPublicPoll.upsert({ where: { characterId }, create: { characterId, ...plan.poll }, update: plan.poll });
    return { characterId, ownerId, role: roleOf(character.role), snapshot, flags, events, session };
  }

  async probeCandidate(): Promise<ProbeCandidate | null> {
    const rows = await this.prisma.$queryRaw<Array<{ region: string; firstName: string; surname: string }>>`
      SELECT c.region, c.first_name AS "firstName", c.surname
      FROM "character" c
      JOIN snapshot s ON s.id = c.last_snapshot_id
      WHERE c.bnet_verified AND s.level >= ${PROBE_MIN_LEVEL}
      ORDER BY s.captured_at DESC
      LIMIT 20`;
    const found = rows.find((r) => isRegion(r.region));
    return found ? { region: found.region as Region, firstName: found.firstName, surname: found.surname } : null;
  }
}
