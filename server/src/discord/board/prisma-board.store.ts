import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { BoardCharacter, BoardPlayer, BoardSnapshot, BoardSort } from '../render/board';
import type { BoardStore, LoadedBoard } from './board-ports';
import { boardPresence } from './board-presence';

const SORTS: readonly BoardSort[] = ['level', 'played', 'name'];

interface CharacterRow {
  firstName: string;
  surname: string;
  classFile: string | null;
  role: string | null;
  lastSnapshotId: bigint | null;
}

/** guild_config, memberships, characters, snapshots and devices, read for the board. */
@Injectable()
export class PrismaBoardStore implements BoardStore {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listBoardGuildIds(): Promise<string[]> {
    const rows = await this.prisma.guildConfig.findMany({
      where: { boardChannelId: { not: null } },
      select: { guildId: true },
      orderBy: { guildId: 'asc' },
    });
    return rows.map((r) => r.guildId);
  }

  async guildIdsOfPlayer(discordUserId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { discordUserId, guild: { boardChannelId: { not: null } } },
      select: { guildId: true },
      orderBy: { guildId: 'asc' },
    });
    return rows.map((r) => r.guildId);
  }

  async load(guildId: string, now: Date): Promise<LoadedBoard | null> {
    const guild = await this.prisma.guildConfig.findUnique({
      where: { guildId },
      select: {
        boardChannelId: true,
        boardMessageIds: true,
        logsChannelId: true,
        boardSort: true,
        memberships: {
          select: {
            player: {
              select: {
                discordUserId: true,
                hideZone: true,
                hidePresence: true,
                characters: {
                  where: { role: { in: ['main', 'alt'] } },
                  select: { firstName: true, surname: true, classFile: true, role: true, lastSnapshotId: true },
                },
                devices: { select: { gameRunning: true, lastSeenAt: true, revokedAt: true } },
              },
            },
          },
        },
      },
    });
    if (!guild?.boardChannelId) return null;

    const players = guild.memberships.map((m) => m.player);
    const snapshotIds = players.flatMap((p) => p.characters.map((c) => c.lastSnapshotId)).filter((id) => id !== null);
    const snapshots = new Map(
      (
        await this.prisma.snapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: { id: true, level: true, xp: true, xpMax: true, playedTotal: true, zone: true },
        })
      ).map(({ id, ...snapshot }) => [id, snapshot satisfies BoardSnapshot]),
    );
    const character = (rows: CharacterRow[], role: 'main' | 'alt'): BoardCharacter | null => {
      const row = rows.find((c) => c.role === role);
      if (!row) return null;
      return {
        firstName: row.firstName,
        surname: row.surname,
        classFile: row.classFile,
        snapshot: (row.lastSnapshotId !== null && snapshots.get(row.lastSnapshotId)) || null,
      };
    };

    return {
      boardChannelId: guild.boardChannelId,
      boardMessageIds: guild.boardMessageIds,
      logsChannelId: guild.logsChannelId,
      input: {
        guild: { boardSort: SORTS.includes(guild.boardSort as BoardSort) ? (guild.boardSort as BoardSort) : 'level' },
        players: players.map(
          (p): BoardPlayer => ({
            discordUserId: p.discordUserId,
            privacy: { hideZone: p.hideZone, hidePresence: p.hidePresence },
            presence: boardPresence(p.devices, now, this.config.heartbeatIntervalSec),
            main: character(p.characters, 'main'),
            alt: character(p.characters, 'alt'),
          }),
        ),
        now,
      },
    };
  }

  async saveMessageIds(guildId: string, messageIds: string[]): Promise<void> {
    await this.prisma.guildConfig.update({ where: { guildId }, data: { boardMessageIds: messageIds } });
  }

  async disableBoard(guildId: string): Promise<void> {
    await this.prisma.guildConfig.update({ where: { guildId }, data: { boardChannelId: null, boardMessageIds: [] } });
  }
}
