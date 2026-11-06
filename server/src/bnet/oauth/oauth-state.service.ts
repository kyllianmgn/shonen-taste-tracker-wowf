import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig, Region } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { sha256Hex } from '../../ingest/pairing/pairing-secrets';
import { BNET_OAUTH_CLOCK, type OauthClock } from './oauth-clock';
import { buildAuthorizeUrl, generateOauthState } from './oauth-secrets';

/** A state is valid 10 minutes and single use (docs/02 « Flux » step 1). */
export const OAUTH_STATE_TTL_SEC = 600;
/** Discord interaction tokens are valid 15 minutes after the command. */
export const INTERACTION_TOKEN_TTL_SEC = 900;

export interface IssueStateInput {
  ownerId: string;
  guildId: string;
  region: Region;
  /** Token of the /lier battlenet interaction: the callback edits its ephemeral reply with it. */
  interactionToken: string;
}

export interface IssuedState {
  url: string;
  expiresAt: Date;
}

export interface ClaimedState {
  ownerId: string;
  guildId: string | null;
  region: Region;
  interactionToken: string;
  /** False once the interaction token is past its 15 minutes: the result then goes by DM. */
  interactionValid: boolean;
}

export type ClaimResult = { status: 'claimed'; state: ClaimedState } | { status: 'unknown' | 'expired' | 'used' };

@Injectable()
export class OauthStateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BNET_OAUTH_CLOCK) private readonly clock: OauthClock,
  ) {}

  /**
   * /lier battlenet: stores the SHA-256 of a fresh state and returns the authorize link. Using /lier
   * on a server also shows the player there (docs/02 « Commandes Discord »), as /lier appli does.
   */
  async issue(input: IssueStateInput): Promise<IssuedState> {
    const { ownerId, guildId } = input;
    await this.prisma.$transaction([
      this.prisma.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`INSERT INTO guild_config (guild_id) VALUES (${guildId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`
        INSERT INTO membership (guild_id, discord_user_id) VALUES (${guildId}, ${ownerId}) ON CONFLICT DO NOTHING`,
    ]);

    // 32 random bytes: a collision is not a case worth handling.
    const state = generateOauthState();
    const expiresAt = new Date(this.clock.now() + OAUTH_STATE_TTL_SEC * 1_000);
    await this.prisma.oauthState.create({
      data: {
        stateSha256: sha256Hex(state),
        ownerId,
        guildId,
        region: input.region,
        interactionToken: input.interactionToken,
        expiresAt,
      },
    });
    const url = buildAuthorizeUrl({ clientId: this.config.bnetClientId, redirectUri: this.config.bnetRedirectUri, state });
    return { url, expiresAt };
  }

  /** Marks the state used with a conditional UPDATE, so two callbacks with one state link once. */
  async claim(state: string): Promise<ClaimResult> {
    const stateSha256 = sha256Hex(state);
    const now = new Date(this.clock.now());

    const [claimed] = await this.prisma.oauthState.updateManyAndReturn({
      where: { stateSha256, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (!claimed) {
      const existing = await this.prisma.oauthState.findUnique({ where: { stateSha256 }, select: { usedAt: true } });
      if (!existing) return { status: 'unknown' };
      return { status: existing.usedAt ? 'used' : 'expired' };
    }

    const issuedAt = claimed.expiresAt.getTime() - OAUTH_STATE_TTL_SEC * 1_000;
    return {
      status: 'claimed',
      state: {
        ownerId: claimed.ownerId,
        guildId: claimed.guildId,
        region: claimed.region as Region,
        interactionToken: claimed.interactionToken,
        interactionValid: now.getTime() < issuedAt + INTERACTION_TOKEN_TTL_SEC * 1_000,
      },
    };
  }
}
