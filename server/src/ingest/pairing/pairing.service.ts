import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ApiError } from '../api/api-error';
import { INGEST_CLOCK, type Clock } from '../clock';
import { generateDeviceToken, generatePairingCode, sha256Hex } from './pairing-secrets';

/** A pairing code is valid 10 minutes (docs/02 « Appairage »). */
export const PAIRING_CODE_TTL_SEC = 600;
/** Codes are random over 32^8; a hash collision with a live code is retried, not reported. */
const MAX_CODE_ATTEMPTS = 3;

/** Body of POST /v1/devices/pair once validated against pair.request.json. */
export interface PairRequest {
  code: string;
  deviceName: string;
  appVersion: string;
  os: 'windows' | 'macos';
}

/** Body of the 201, see pair.response.json. The token is returned here only, never stored in clear. */
export interface PairResponse {
  deviceId: string;
  deviceToken: string;
  heartbeatIntervalSec: number;
}

export interface IssuedCode {
  code: string;
  expiresAt: Date;
}

@Injectable()
export class PairingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * /lier appli: a single-use code tied to the Discord member. Using /lier on a server also shows the
   * player there (docs/02 « Commandes Discord »), hence the player, guild_config and membership rows.
   */
  async issueCode(opts: { discordUserId: string; guildId: string }): Promise<IssuedCode> {
    const { discordUserId, guildId } = opts;
    // ON CONFLICT DO NOTHING, like CharacterService: safe when two commands race, never touches existing rows.
    await this.prisma.$transaction([
      this.prisma.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${discordUserId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`INSERT INTO guild_config (guild_id) VALUES (${guildId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`
        INSERT INTO membership (guild_id, discord_user_id) VALUES (${guildId}, ${discordUserId}) ON CONFLICT DO NOTHING`,
    ]);

    const expiresAt = new Date(this.clock.now() + PAIRING_CODE_TTL_SEC * 1_000);
    for (let attempt = 1; ; attempt++) {
      const code = generatePairingCode();
      try {
        await this.prisma.pairingCode.create({ data: { codeSha256: sha256Hex(code), ownerId: discordUserId, expiresAt } });
        return { code, expiresAt };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= MAX_CODE_ATTEMPTS) throw error;
      }
    }
  }

  /**
   * POST /v1/devices/pair. The code is claimed and the device created in one transaction; claiming
   * is a conditional UPDATE, so two concurrent uses of one code pair a single device.
   */
  async pair(request: PairRequest): Promise<PairResponse> {
    const codeSha256 = sha256Hex(request.code);
    const now = new Date(this.clock.now());
    const deviceToken = generateDeviceToken();

    const deviceId = await this.prisma.$transaction(async (tx) => {
      const [claimed] = await tx.pairingCode.updateManyAndReturn({
        where: { codeSha256, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
        select: { ownerId: true },
      });
      if (!claimed) {
        const existing = await tx.pairingCode.findUnique({ where: { codeSha256 }, select: { usedAt: true } });
        if (!existing) throw new ApiError('code_unknown');
        throw new ApiError(existing.usedAt ? 'code_used' : 'code_expired');
      }

      const device = await tx.device.create({
        data: {
          ownerId: claimed.ownerId,
          tokenSha256: sha256Hex(deviceToken),
          name: request.deviceName,
          appVersion: request.appVersion,
          os: request.os,
          lastSeenAt: now,
        },
        select: { id: true },
      });
      return device.id;
    });

    return { deviceId, deviceToken, heartbeatIntervalSec: this.config.heartbeatIntervalSec };
  }

  /** DELETE /v1/devices/me. */
  async revoke(deviceId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id: deviceId, revokedAt: null },
      data: { revokedAt: new Date(this.clock.now()) },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
