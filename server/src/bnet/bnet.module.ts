import { Module, type FactoryProvider } from '@nestjs/common';
import type { AppConfig } from '../common/config/config';
import { APP_CONFIG } from '../common/config/config.constants';
import { CoreModule } from '../core/core.module';
import { DiscordModule } from '../discord/discord.module';
import { BnetClient } from './client';
import { BnetLinkService } from './oauth/bnet-link.service';
import { OauthCallbackController } from './oauth/oauth-callback.controller';
import { BNET_OAUTH_CLOCK, systemOauthClock } from './oauth/oauth-clock';
import { OauthStateService } from './oauth/oauth-state.service';
import { BNET_USER_TOKEN_SINK, DiscardUserTokenSink } from './oauth/user-token-sink';

export const bnetClientProvider: FactoryProvider<BnetClient> = {
  provide: BnetClient,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new BnetClient({ clientId: config.bnetClientId, clientSecret: config.bnetClientSecret }),
};

/**
 * Player OAuth and the Blizzard Forever API client (docs/02 « Modules »). The Discord side of the
 * link (reply edit, DM, admin notice) comes from DiscordModule through BNET_LINK_NOTIFIER.
 */
@Module({
  imports: [CoreModule, DiscordModule],
  controllers: [OauthCallbackController],
  providers: [
    bnetClientProvider,
    { provide: BNET_OAUTH_CLOCK, useValue: systemOauthClock },
    // S-18 (base mode) replaces this sink to keep the token encrypted in bnet_token.
    { provide: BNET_USER_TOKEN_SINK, useClass: DiscardUserTokenSink },
    OauthStateService,
    BnetLinkService,
  ],
  exports: [BnetClient, OauthStateService],
})
export class BnetModule {}
