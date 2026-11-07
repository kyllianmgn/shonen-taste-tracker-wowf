import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { SuspectItem } from './admin-replies';

/** At most this many snapshots and this many events are read; the reply truncates anyway. */
const LIMIT = 50;

const CHARACTER = { select: { region: true, firstName: true, surname: true, ownerId: true } } as const;

/**
 * /admin suspects: flagged snapshots (by received_at) and events (by at) since `since`, of the
 * characters owned by members shown on this guild. Newest first.
 */
@Injectable()
export class SuspectsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(guildId: string, since: Date): Promise<SuspectItem[]> {
    const ofGuild = { owner: { memberships: { some: { guildId } } } };
    const [snapshots, events] = await Promise.all([
      this.prisma.snapshot.findMany({
        where: { flags: { isEmpty: false }, receivedAt: { gte: since }, character: ofGuild },
        select: { receivedAt: true, level: true, flags: true, character: CHARACTER },
        orderBy: { receivedAt: 'desc' },
        take: LIMIT,
      }),
      this.prisma.gameEvent.findMany({
        where: { flags: { isEmpty: false }, at: { gte: since }, character: ofGuild },
        select: { at: true, type: true, flags: true, character: CHARACTER },
        orderBy: { at: 'desc' },
        take: LIMIT,
      }),
    ]);

    const items: SuspectItem[] = [
      ...snapshots.map(({ receivedAt, level, flags, character: { ownerId, ...character } }): SuspectItem => ({
        kind: 'snapshot',
        at: receivedAt,
        character,
        ownerId,
        level,
        flags,
      })),
      ...events.map(({ at, type, flags, character: { ownerId, ...character } }): SuspectItem => ({
        kind: 'event',
        at,
        character,
        ownerId,
        type,
        flags,
      })),
    ];
    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }
}
