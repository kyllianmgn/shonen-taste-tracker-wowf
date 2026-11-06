import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module';
import { PresenceExpiryJob } from './presence-expiry.job';

/** Scheduled tasks: expiry, board debounce, cleanup (docs/02 « Modules »). */
@Module({
  imports: [PresenceModule],
  providers: [PresenceExpiryJob],
})
export class JobsModule {}
