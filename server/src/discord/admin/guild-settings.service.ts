import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { BoardSort } from '../render/board';
import type { GuildSettings, GuildSettingsPatch } from './admin-replies';

const SORTS: readonly BoardSort[] = ['level', 'played', 'name'];
const SELECT = { levelAnnounceStep: true, logDeaths: true, boardSort: true, boardChannelId: true } as const;
const DEFAULTS: GuildSettings = { levelAnnounceStep: 1, logDeaths: false, boardSort: 'level', boardChannelId: null };

type Row = Omit<GuildSettings, 'boardSort'> & { boardSort: string };
const toSettings = (row: Row): GuildSettings => ({
  ...row,
  boardSort: SORTS.includes(row.boardSort as BoardSort) ? (row.boardSort as BoardSort) : 'level',
});

/** guild_config settings changed by /config (docs/02 « Admin »). */
@Injectable()
export class GuildSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(guildId: string): Promise<GuildSettings> {
    const row = await this.prisma.guildConfig.findUnique({ where: { guildId }, select: SELECT });
    return row ? toSettings(row) : { ...DEFAULTS };
  }

  /** Creates the guild_config with its defaults if /setup never ran. */
  async update(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings> {
    const row = await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: { guildId, ...patch },
      update: patch,
      select: SELECT,
    });
    return toSettings(row);
  }
}
