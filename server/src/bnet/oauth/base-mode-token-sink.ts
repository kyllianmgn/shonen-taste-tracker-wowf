import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { encryptToken } from '../../common/crypto/token-cipher';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlayerModeService } from '../../core/players/player-mode.service';
import type { PlayerBnetToken, UserTokenSink } from './user-token-sink';

/**
 * docs/02 « Flux » step 7 with the base mode (S-18): a player without an active device keeps the
 * token AES-256-GCM encrypted in bnet_token until it expires, for the polling job; a new link
 * replaces the previous token. In app mode the token is thrown away.
 */
@Injectable()
export class BaseModeTokenSink implements UserTokenSink {
  private readonly logger = new Logger(BaseModeTokenSink.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modes: PlayerModeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async receive(token: PlayerBnetToken): Promise<void> {
    if ((await this.modes.modeOf(token.ownerId)) !== 'base') return;
    const data = {
      region: token.region,
      tokenEncrypted: encryptToken(this.config.tokenEncKey, token.accessToken),
      expiresAt: token.expiresAt,
    };
    await this.prisma.bnetToken.upsert({ where: { ownerId: token.ownerId }, create: { ownerId: token.ownerId, ...data }, update: data });
    this.logger.log(`Battle.net token kept for ${token.ownerId} (base mode) until ${token.expiresAt.toISOString()}`);
  }
}
