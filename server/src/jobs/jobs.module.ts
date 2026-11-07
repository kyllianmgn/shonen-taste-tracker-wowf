import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { DiscordModule } from '../discord/discord.module';
import { PresenceModule } from '../presence/presence.module';
import { BoardRedrawJob } from './board-redraw.job';
import { LogsSendJob } from './logs-send.job';
import { OrphanCleanupJob } from './orphan-cleanup.job';
import { PresenceExpiryJob } from './presence-expiry.job';

/** Scheduled tasks: expiry, board debounce, logs send queue, cleanup (docs/02 « Modules »). */
@Module({
  imports: [CoreModule, PresenceModule, DiscordModule],
  providers: [PresenceExpiryJob, BoardRedrawJob, LogsSendJob, OrphanCleanupJob],
})
export class JobsModule {}
