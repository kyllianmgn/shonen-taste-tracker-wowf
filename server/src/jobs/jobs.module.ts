import { Module } from '@nestjs/common';
import { BnetModule } from '../bnet/bnet.module';
import { CoreModule } from '../core/core.module';
import { DiscordModule } from '../discord/discord.module';
import { PresenceModule } from '../presence/presence.module';
import { BnetPublicPollJob } from './bnet-public-poll.job';
import { BnetPublicProbeJob } from './bnet-public-probe.job';
import { BoardRedrawJob } from './board-redraw.job';
import { LogsSendJob } from './logs-send.job';
import { OrphanCleanupJob } from './orphan-cleanup.job';
import { PresenceExpiryJob } from './presence-expiry.job';

/** Scheduled tasks: expiry, board debounce, logs send queue, public profile readings, cleanup (docs/02 « Modules »). */
@Module({
  imports: [CoreModule, PresenceModule, DiscordModule, BnetModule],
  providers: [PresenceExpiryJob, BoardRedrawJob, LogsSendJob, OrphanCleanupJob, BnetPublicProbeJob, BnetPublicPollJob],
})
export class JobsModule {}
