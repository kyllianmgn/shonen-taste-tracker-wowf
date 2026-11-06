import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AppConfig, Region } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CharacterService } from '../../core/characters/character.service';
import type { BnetLinkEntry } from '../../core/characters/character.types';
import { BnetClient, BnetNotFoundError, BnetUnauthorizedError, type BnetAccountProfile } from '../client';
import { accountCharacters, type AccountCharacter } from './account-characters';
import type { CallbackPageKind } from './callback-page';
import { BNET_LINK_NOTIFIER, type BnetLinkNotifier } from './link-notifier';
import type { LinkedCharacter, LinkOutcome } from './link-outcome';
import { BNET_OAUTH_CLOCK, type OauthClock } from './oauth-clock';
import { OauthStateService, type ClaimedState } from './oauth-state.service';
import { BNET_USER_TOKEN_SINK, type UserTokenSink } from './user-token-sink';

/** Query string of GET /oauth/bnet/callback, untrusted. */
export interface CallbackQuery {
  code?: unknown;
  state?: unknown;
  error?: unknown;
}

const MAX_PARAM_LENGTH = 2048;
const param = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PARAM_LENGTH ? value : null;

/**
 * GET /oauth/bnet/callback (docs/02 « Liaison Battle.net », steps 2 to 7 and « Erreurs »).
 * Never logs the code, the state or a token.
 */
@Injectable()
export class BnetLinkService {
  private readonly logger = new Logger(BnetLinkService.name);

  constructor(
    private readonly states: OauthStateService,
    private readonly bnet: BnetClient,
    private readonly characters: CharacterService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BNET_OAUTH_CLOCK) private readonly clock: OauthClock,
    @Inject(BNET_LINK_NOTIFIER) private readonly notifier: BnetLinkNotifier,
    @Inject(BNET_USER_TOKEN_SINK) private readonly tokenSink: UserTokenSink,
  ) {}

  /** Runs the callback and returns the page to show in the browser. */
  async complete(query: CallbackQuery): Promise<CallbackPageKind> {
    const rawState = param(query.state);
    if (!rawState) return 'state_unknown';

    // The state is claimed first: whatever happens next, it never serves twice.
    const claim = await this.states.claim(rawState);
    if (claim.status !== 'claimed') return `state_${claim.status}`;
    const state = claim.state;

    const outcome = await this.link(state, query);
    await this.notifier.deliver(
      { userId: state.ownerId, interactionToken: state.interactionToken, interactionValid: state.interactionValid },
      outcome,
    );
    return outcome.status === 'linked' ? 'linked' : outcome.status;
  }

  private async link(state: ClaimedState, query: CallbackQuery): Promise<LinkOutcome> {
    if (query.error !== undefined) return { status: 'denied' };
    const code = param(query.code);
    if (!code) {
      this.logger.warn(`Battle.net callback without code for ${state.ownerId}`);
      return { status: 'failed' };
    }

    try {
      const token = await this.bnet.exchangeAuthorizationCode(code, this.config.bnetRedirectUri);
      const profile = await this.accountProfile(state.region, token.accessToken);
      const found = accountCharacters(profile);
      const entries = await this.characters.linkFromBnet({
        ownerId: state.ownerId,
        region: state.region,
        characters: await this.withRealms(state.region, found),
      });
      await this.reportTransfers(state.ownerId, entries);

      // Step 7: kept encrypted in base mode, thrown away in app mode (BaseModeTokenSink).
      await this.tokenSink.receive({
        ownerId: state.ownerId,
        region: state.region,
        accessToken: token.accessToken,
        expiresAt: new Date(this.clock.now() + token.expiresInSec * 1_000),
      });

      return { status: 'linked', region: state.region, characters: linked(entries, found) };
    } catch (error) {
      if (error instanceof BnetNotFoundError) return { status: 'no_characters' };
      this.logger.error(`Battle.net link failed for ${state.ownerId}: ${describe(error)}`);
      return { status: 'failed' };
    }
  }

  /** docs/02 « Erreurs »: a 401 / 403 is retried once with the same token. */
  private async accountProfile(region: Region, accessToken: string): Promise<BnetAccountProfile> {
    try {
      return await this.bnet.getAccountProfile(region, accessToken);
    } catch (error) {
      if (!(error instanceof BnetUnauthorizedError)) throw error;
      this.logger.warn(`Battle.net account profile: HTTP ${error.status}, retrying once`);
      return this.bnet.getAccountProfile(region, accessToken);
    }
  }

  /** Realm name and ruleset from the realm index (cached 24 h); a failure only leaves them empty. */
  private async withRealms(region: Region, found: AccountCharacter[]) {
    const realmIds = [...new Set(found.map((c) => c.realmId).filter((id): id is number => id !== null))];
    const realms = new Map<number, { name: string; ruleset: string }>();
    for (const id of realmIds) {
      try {
        const realm = await this.bnet.getRealm(region, id);
        realms.set(id, { name: realm.name, ruleset: realm.ruleset });
      } catch (error) {
        this.logger.warn(`Battle.net realm ${id} (${region}) unavailable: ${describe(error)}`);
      }
    }
    return found.map((c) => {
      const realm = c.realmId === null ? undefined : realms.get(c.realmId);
      return {
        firstName: c.firstName,
        surname: c.surname,
        classFile: c.classFile,
        raceFile: c.raceFile,
        faction: c.faction,
        realmName: realm?.name || null,
        ruleset: realm?.ruleset ?? null,
      };
    });
  }

  /**
   * Step 5 « signalé aux admins »: one line in the logs channel of every server where the former or
   * the new owner is shown. Servers without logs channel are skipped.
   */
  private async reportTransfers(ownerId: string, entries: BnetLinkEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.outcome !== 'transferred' || !entry.previousOwnerId) continue;
      const from = entry.previousOwnerId;
      this.logger.log(`Character ${entry.character.id} transferred from ${from} to ${ownerId} by Battle.net`);
      const guilds = await this.prisma.guildConfig.findMany({
        where: { logsChannelId: { not: null }, memberships: { some: { discordUserId: { in: [from, ownerId] } } } },
        select: { logsChannelId: true },
      });
      const channelIds = guilds.map((g) => g.logsChannelId).filter((id): id is string => id !== null);
      await this.notifier.notifyTransfer(channelIds, { character: entry.character, fromUserId: from, toUserId: ownerId });
    }
  }
}

function linked(entries: BnetLinkEntry[], found: AccountCharacter[]): LinkedCharacter[] {
  const levels = new Map(found.map((c) => [`${c.firstName}\u0000${c.surname}`.toLowerCase(), c.level]));
  return entries.map((e) => ({
    ...e.character,
    level: levels.get(`${e.character.firstName}\u0000${e.character.surname}`.toLowerCase()) ?? null,
    role: e.role,
    outcome: e.outcome,
  }));
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
