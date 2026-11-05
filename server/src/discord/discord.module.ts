import { Module } from '@nestjs/common';
import { Client, GatewayIntentBits } from 'discord.js';
import { DISCORD_CLIENT, DiscordClientService } from './client/discord-client.service';
import { CommandRegistry, loadCommandHandlers } from './registry/command-registry';
import { PrismaGuildConfigStore } from './setup/prisma-guild-config.store';
import { GUILD_CONFIG_STORE, SetupService } from './setup/setup.service';

/** Commands, board rendering, log publishing, send queue (docs/02 « Modules »). */
@Module({
  providers: [
    // No privileged intent: slash commands only (docs/00 « Contraintes Discord »).
    { provide: DISCORD_CLIENT, useFactory: () => new Client({ intents: [GatewayIntentBits.Guilds] }) },
    { provide: CommandRegistry, useFactory: () => new CommandRegistry(loadCommandHandlers()) },
    { provide: GUILD_CONFIG_STORE, useClass: PrismaGuildConfigStore },
    SetupService,
    DiscordClientService,
  ],
})
export class DiscordModule {}
