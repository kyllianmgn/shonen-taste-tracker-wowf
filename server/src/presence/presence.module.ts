import { Module } from '@nestjs/common';
import { presenceClockProvider, PRESENCE_CLOCK } from './presence.clock';
import { PresenceService } from './presence.service';

/** Sessions, online/offline transitions, heartbeat expiry (docs/02 « Modules »). */
@Module({
  providers: [presenceClockProvider, PresenceService],
  exports: [PRESENCE_CLOCK, PresenceService],
})
export class PresenceModule {}
