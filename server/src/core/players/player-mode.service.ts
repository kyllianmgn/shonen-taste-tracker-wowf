import { Injectable } from '@nestjs/common';
import { REGIONS, type Region } from '../../common/config/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { playerMode, type PlayerMode } from './player-mode';

/** Database side of the player mode (docs/02 « Mode de base »). */
@Injectable()
export class PlayerModeService {
  constructor(private readonly prisma: PrismaService) {}

  async modeOf(ownerId: string, now = new Date()): Promise<PlayerMode> {
    const devices = await this.prisma.device.findMany({
      where: { ownerId },
      select: { lastSeenAt: true, revokedAt: true },
    });
    return playerMode(devices, now);
  }

  /**
   * Region to relink Battle.net in, when /perso liste must offer « Relier Battle.net »: a base-mode
   * player with Battle.net-verified characters and no valid token any more. Null otherwise.
   * The region is the main's when it is verified, else the first verified character's.
   */
  async bnetRelinkRegion(ownerId: string, now = new Date()): Promise<Region | null> {
    const [verified, validToken] = await Promise.all([
      this.prisma.character.findMany({
        where: { ownerId, bnetVerified: true },
        select: { region: true, role: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.bnetToken.count({ where: { ownerId, expiresAt: { gt: now } } }),
    ]);
    if (verified.length === 0 || validToken > 0) return null;
    if ((await this.modeOf(ownerId, now)) !== 'base') return null;
    const region = (verified.find((c) => c.role === 'main') ?? verified[0]).region;
    return (REGIONS as readonly string[]).includes(region) ? (region as Region) : null;
  }
}
