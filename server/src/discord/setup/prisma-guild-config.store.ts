import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { GuildChannelsConfig, GuildConfigStore } from './setup-ports';

/** guild_config through Prisma; other columns keep their defaults on creation and are never touched. */
@Injectable()
export class PrismaGuildConfigStore implements GuildConfigStore {
  constructor(private readonly prisma: PrismaService) {}

  find(guildId: string): Promise<GuildChannelsConfig | null> {
    return this.prisma.guildConfig.findUnique({
      where: { guildId },
      select: { boardChannelId: true, logsChannelId: true, boardMessageIds: true },
    });
  }

  async saveChannels(guildId: string, channels: GuildChannelsConfig): Promise<void> {
    await this.prisma.guildConfig.upsert({
      where: { guildId },
      create: { guildId, ...channels },
      update: channels,
    });
  }
}
