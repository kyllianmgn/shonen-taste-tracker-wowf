import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** player.hide_* flags (docs/02 « Commandes Discord » → /confidentialite). */
export interface Privacy {
  hideMoney: boolean;
  hideZone: boolean;
  hidePresence: boolean;
}
export type PrivacyPatch = Partial<Privacy>;

export interface QuitResult {
  /** false when the player had no row. */
  deleted: boolean;
  /** Guilds where the player was shown, so their boards can be redrawn. */
  guildIds: string[];
}

const DEFAULT_PRIVACY: Privacy = { hideMoney: false, hideZone: false, hidePresence: false };
const PRIVACY_SELECT = { hideMoney: true, hideZone: true, hidePresence: true } as const;

/** The player row as a whole: privacy settings and /quitter (docs/02 « Modèle de données »). */
@Injectable()
export class PlayerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async getPrivacy(ownerId: string): Promise<Privacy> {
    const row = await this.prisma.player.findUnique({ where: { discordUserId: ownerId }, select: PRIVACY_SELECT });
    return row ?? { ...DEFAULT_PRIVACY };
  }

  async setPrivacy(ownerId: string, patch: PrivacyPatch): Promise<Privacy> {
    return this.prisma.player.upsert({
      where: { discordUserId: ownerId },
      create: { discordUserId: ownerId, ...patch },
      update: patch,
      select: PRIVACY_SELECT,
    });
  }

  /**
   * /quitter: characters are detached (no owner, untracked); devices, pairing codes, sessions,
   * memberships, Battle.net token and OAuth states go with the player row (ON DELETE CASCADE).
   * A deleted device answers 401 on its next request. Snapshots and events stay until the cleanup
   * job deletes the orphan characters. Same player-row lock as the sync and the presence engine.
   */
  async quit(ownerId: string): Promise<QuitResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
      if (locked.length === 0) return { deleted: false, guildIds: [] };

      const memberships = await tx.membership.findMany({ where: { discordUserId: ownerId }, select: { guildId: true } });
      await tx.character.updateMany({ where: { ownerId }, data: { ownerId: null, role: 'untracked' } });
      await tx.player.delete({ where: { discordUserId: ownerId } });
      return { deleted: true, guildIds: memberships.map((m) => m.guildId) };
    });
  }

  /** Cleanup job: characters without owner, with their snapshots and events (cascade). Returns the count. */
  async deleteOrphanCharacters(): Promise<number> {
    const { count } = await this.prisma.character.deleteMany({ where: { ownerId: null } });
    return count;
  }
}
