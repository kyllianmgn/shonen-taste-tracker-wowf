import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Client, Events, type Interaction } from 'discord.js';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { HealthRegistry } from '../../common/health/health.registry';
import { COMMAND_DEFINITIONS } from '../registry/command-definitions';
import type { CommandContext } from '../registry/command-handler';
import { CommandRegistry } from '../registry/command-registry';

/** The discord.js client, built by DiscordModule; e2e tests replace it with a fake. */
export const DISCORD_CLIENT = Symbol('DISCORD_CLIENT');

/**
 * Gateway connection (intent Guilds only), command registration and interaction routing.
 * Login happens when the service starts; a bad token stops the startup.
 */
@Injectable()
export class DiscordClientService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DiscordClientService.name);
  private readonly ctx: CommandContext;

  constructor(
    @Inject(DISCORD_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: CommandRegistry,
    moduleRef: ModuleRef,
    health: HealthRegistry,
  ) {
    this.ctx = { get: (token) => moduleRef.get(token, { strict: false }) };
    health.register('discord', () => this.client.isReady());
  }

  async onApplicationBootstrap(): Promise<void> {
    this.client.once(Events.ClientReady, () => void this.registerCommands());
    this.client.on(Events.InteractionCreate, (interaction: Interaction) => {
      void this.registry.handle(interaction, this.ctx);
    });
    this.client.on(Events.Error, (error: Error) => this.logger.error(`Gateway error: ${error.message}`));
    await this.client.login(this.config.discordToken);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.destroy();
  }

  private async registerCommands(): Promise<void> {
    const guildId = this.config.discordDevGuildId;
    const commands = this.client.application?.commands;
    if (!commands) {
      this.logger.error('Cannot register slash commands: application not available');
      return;
    }
    try {
      if (guildId) await commands.set(COMMAND_DEFINITIONS, guildId);
      else await commands.set(COMMAND_DEFINITIONS);
      const pending = this.registry.pendingKeys().length;
      this.logger.log(
        `Registered ${COMMAND_DEFINITIONS.length} slash commands ${guildId ? `on guild ${guildId}` : 'globally'}` +
          ` (${pending} still « Bientôt disponible »)`,
      );
    } catch (error) {
      this.logger.error(`Slash command registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
