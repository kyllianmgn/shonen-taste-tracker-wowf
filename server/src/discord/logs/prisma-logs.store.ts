import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LogPrivacy } from '../render/logs';
import type { ClaimedEvent, LogCharacterInfo, LogTarget, LogsStore } from './logs-ports';

const VISIBLE: LogPrivacy = { hideMoney: false, hideZone: false, hidePresence: false };
/** snapshot.detail.sex: 2 male, 3 female (UnitSex). */
const FEMALE = '3';

interface CharacterRow {
  firstName: string;
  surname: string;
  role: string | null;
  level: number | null;
  sex: string | null;
}

/** guild_config, membership, player privacy, characters and game_event.published_at, for the logs. */
@Injectable()
export class PrismaLogsStore implements LogsStore {
  constructor(private readonly prisma: PrismaService) {}

  async targetsOfPlayer(discordUserId: string): Promise<LogTarget[]> {
    const rows = await this.prisma.membership.findMany({
      where: { discordUserId, guild: { logsChannelId: { not: null } } },
      select: { guild: { select: { guildId: true, logsChannelId: true, levelAnnounceStep: true, logDeaths: true } } },
      orderBy: { guildId: 'asc' },
    });
    return rows.map(({ guild }) => ({
      guildId: guild.guildId,
      logsChannelId: guild.logsChannelId!,
      levelAnnounceStep: guild.levelAnnounceStep,
      logDeaths: guild.logDeaths,
    }));
  }

  async privacyOf(discordUserId: string): Promise<LogPrivacy> {
    const player = await this.prisma.player.findUnique({
      where: { discordUserId },
      select: { hideMoney: true, hideZone: true, hidePresence: true },
    });
    return player ?? VISIBLE;
  }

  async characterOf(characterId: bigint): Promise<LogCharacterInfo | null> {
    const rows = await this.prisma.$queryRaw<CharacterRow[]>`
      SELECT c.first_name AS "firstName", c.surname, c.role, s.level, s.detail->>'sex' AS sex
      FROM "character" c
      LEFT JOIN snapshot s ON s.id = c.last_snapshot_id
      WHERE c.id = ${characterId}`;
    const row = rows[0];
    if (!row) return null;
    return {
      firstName: row.firstName,
      surname: row.surname,
      role: row.role === 'main' || row.role === 'alt' ? row.role : 'untracked',
      level: row.level,
      female: row.sex === FEMALE,
    };
  }

  /**
   * The character row is locked so two LEVEL_UPs of the same level (addon and Battle.net) are
   * claimed one after the other: only the first one wins.
   */
  claimEvent(event: ClaimedEvent, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "character" WHERE id = ${event.characterId} FOR UPDATE`;
      if (event.type === 'LEVEL_UP' && event.level !== null) {
        const published = await tx.gameEvent.findFirst({
          where: {
            characterId: event.characterId,
            type: 'LEVEL_UP',
            id: { not: event.id },
            publishedAt: { not: null },
            data: { path: ['level'], equals: event.level },
          },
          select: { id: true },
        });
        if (published) return false;
      }
      const { count } = await tx.gameEvent.updateMany({ where: { id: event.id, publishedAt: null }, data: { publishedAt: now } });
      return count === 1;
    });
  }
}
