import { Module, type FactoryProvider } from '@nestjs/common';
import type { AppConfig } from '../common/config/config';
import { APP_CONFIG } from '../common/config/config.constants';
import { CoreModule } from '../core/core.module';
import { DiscordModule } from '../discord/discord.module';
import { BnetClient } from './client';
import { BaseModeTokenSink } from './oauth/base-mode-token-sink';
import { BnetLinkService } from './oauth/bnet-link.service';
import { OauthCallbackController } from './oauth/oauth-callback.controller';
import { BNET_OAUTH_CLOCK, systemOauthClock } from './oauth/oauth-clock';
import { OauthStateService } from './oauth/oauth-state.service';
import { BNET_USER_TOKEN_SINK } from './oauth/user-token-sink';
import { BnetAccountPoller } from './polling/bnet-account-poller.service';
import { BnetPollingJob } from './polling/bnet-polling.job';
import { BNET_POLL_CLOCK, systemPollClock } from './polling/poll-clock';

export const bnetClientProvider: FactoryProvider<BnetClient> = {
  provide: BnetClient,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => new BnetClient({ clientId: config.bnetClientId, clientSecret: config.bnetClientSecret }),
};

/**
 * Player OAuth, base-mode polling and the Blizzard Forever API client (docs/02 « Modules »). The Discord side of the
 * link (reply edit, DM, admin notice) comes from DiscordModule through BNET_LINK_NOTIFIER.
 */
@Module({
  imports: [CoreModule, DiscordModule],
  controllers: [OauthCallbackController],
  providers: [
    bnetClientProvider,
    { provide: BNET_OAUTH_CLOCK, useValue: systemOauthClock },
    // Base mode keeps the token encrypted in bnet_token; app mode throws it away (S-18).
    { provide: BNET_USER_TOKEN_SINK, useClass: BaseModeTokenSink },
    { provide: BNET_POLL_CLOCK, useValue: systemPollClock },
    BnetAccountPoller,
    BnetPollingJob,
    OauthStateService,
    BnetLinkService,
  ],
  exports: [BnetClient, OauthStateService],
})
export class BnetModule {}
