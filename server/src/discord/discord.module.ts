import { Module } from '@nestjs/common';
import { Client, GatewayIntentBits } from 'discord.js';
import type { AppConfig } from '../common/config/config';
import { APP_CONFIG } from '../common/config/config.constants';
import { GuildSettingsService } from './admin/guild-settings.service';
import { SuspectsQueryService } from './admin/suspects-query.service';
import { BoardEventsListener } from './board/board-events.listener';
import { BOARD_STORE, type BoardStore } from './board/board-ports';
import { BoardPublisher } from './board/board-publisher';
import { PrismaBoardStore } from './board/prisma-board.store';
import { DISCORD_CLIENT, DiscordClientService } from './client/discord-client.service';
import { LogsEventsListener } from './logs/logs-events.listener';
import { LOGS_STORE, type LogsStore } from './logs/logs-ports';
import { LogsPublisher } from './logs/logs-publisher';
import { PrismaLogsStore } from './logs/prisma-logs.store';
import { BNET_LINK_NOTIFIER } from '../bnet/oauth/link-notifier';
import { DiscordBnetLinkNotifier } from './bnet-link/discord-bnet-link-notifier';
import { CommandRegistry, loadCommandHandlers, loadComponentHandlers } from './registry/command-registry';
import { ProfileQueryService } from './profile/profile-query.service';
import { PrismaGuildConfigStore } from './setup/prisma-guild-config.store';
import { GUILD_CONFIG_STORE, SetupService } from './setup/setup.service';

/** Commands, board rendering, log publishing, send queue (docs/02 « Modules »). */
@Module({
  providers: [
    // No privileged intent: slash commands only (docs/00 « Contraintes Discord »).
    { provide: DISCORD_CLIENT, useFactory: () => new Client({ intents: [GatewayIntentBits.Guilds] }) },
    {
      provide: CommandRegistry,
      useFactory: () => new CommandRegistry(loadCommandHandlers(), undefined, loadComponentHandlers()),
    },
    { provide: GUILD_CONFIG_STORE, useClass: PrismaGuildConfigStore },
    SetupService,
    ProfileQueryService,
    GuildSettingsService,
    SuspectsQueryService,
    DiscordClientService,
    { provide: BNET_LINK_NOTIFIER, useClass: DiscordBnetLinkNotifier },
    { provide: BOARD_STORE, useClass: PrismaBoardStore },
    {
      provide: BoardPublisher,
      inject: [BOARD_STORE, DISCORD_CLIENT, APP_CONFIG],
      useFactory: (store: BoardStore, client: Client, config: AppConfig) =>
        new BoardPublisher(store, client.rest, {
          minEditIntervalMs: config.boardMinEditIntervalSec * 1000,
          now: () => Date.now(),
        }),
    },
    BoardEventsListener,
    { provide: LOGS_STORE, useClass: PrismaLogsStore },
    {
      provide: LogsPublisher,
      inject: [LOGS_STORE, DISCORD_CLIENT],
      useFactory: (store: LogsStore, client: Client) => new LogsPublisher(store, client.rest, { now: () => Date.now() }),
    },
    LogsEventsListener,
  ],
  exports: [BNET_LINK_NOTIFIER, BoardPublisher, LogsPublisher],
})
export class DiscordModule {}
