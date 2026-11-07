import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { DiscordModule } from '../discord/discord.module';
import { PresenceModule } from '../presence/presence.module';
import { BoardRedrawJob } from './board-redraw.job';
import { OrphanCleanupJob } from './orphan-cleanup.job';
import { PresenceExpiryJob } from './presence-expiry.job';

/** Scheduled tasks: expiry, board debounce, cleanup (docs/02 « Modules »). */
@Module({
  imports: [CoreModule, PresenceModule, DiscordModule],
  providers: [PresenceExpiryJob, BoardRedrawJob, OrphanCleanupJob],
})
export class JobsModule {}
