import { Module } from '@nestjs/common';
import type { AppConfig } from '../common/config/config';
import { APP_CONFIG } from '../common/config/config.constants';
import { BnetClient } from './client';

/** Player OAuth and the Blizzard Forever API client (docs/02 « Modules »). */
@Module({
  providers: [
    {
      provide: BnetClient,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new BnetClient({ clientId: config.bnetClientId, clientSecret: config.bnetClientSecret }),
    },
  ],
  exports: [BnetClient],
})
export class BnetModule {}
