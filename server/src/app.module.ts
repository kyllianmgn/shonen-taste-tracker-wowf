import { DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BnetModule } from './bnet/bnet.module';
import { CommonModule } from './common/common.module';
import type { AppConfig } from './common/config/config';
import { CoreModule } from './core/core.module';
import { DiscordModule } from './discord/discord.module';
import { IngestModule } from './ingest/ingest.module';
import { JobsModule } from './jobs/jobs.module';
import { PresenceModule } from './presence/presence.module';

@Module({})
export class AppModule {
  /** The config is validated before Nest starts (see main.ts) and injected from here. */
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.register(config),
        // Internal events between modules: character.updated, event.recorded, session.* (docs/02 « Modules »).
        EventEmitterModule.forRoot(),
        CoreModule,
        IngestModule,
        PresenceModule,
        DiscordModule,
        BnetModule,
        JobsModule,
      ],
    };
  }
}
