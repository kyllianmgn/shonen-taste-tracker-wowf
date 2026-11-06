import { Logger } from '@nestjs/common';
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageComponentInteraction,
} from 'discord.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MSG } from '../messages';
import { commandKeys } from './command-definitions';
import { interactionKey, type CommandContext, type CommandHandler, type ComponentHandler } from './command-handler';

export const COMMANDS_DIR = join(__dirname, '..', 'commands');

/** Source or compiled handler files; tests, declarations and source maps are skipped. */
export function isHandlerFile(name: string): boolean {
  return /\.(ts|js)$/.test(name) && !/\.(spec|test|d)\.(ts|js)$/.test(name);
}

/** Requires every handler file of `dir` and collects their `handlers` exports. */
export function loadCommandHandlers(dir: string = COMMANDS_DIR): CommandHandler[] {
  const handlers: CommandHandler[] = [];
  for (const [file, exported] of handlerModules(dir)) {
    if (!Array.isArray(exported.handlers)) throw new Error(`Command file ${file} must export \`handlers: CommandHandler[]\``);
    handlers.push(...(exported.handlers as CommandHandler[]));
  }
  return handlers;
}

/** Collects the optional `components` exports of the handler files of `dir`. */
export function loadComponentHandlers(dir: string = COMMANDS_DIR): ComponentHandler[] {
  const components: ComponentHandler[] = [];
  for (const [file, exported] of handlerModules(dir)) {
    if (exported.components === undefined) continue;
    if (!Array.isArray(exported.components)) throw new Error(`\`components\` of ${file} must be a ComponentHandler[]`);
    components.push(...(exported.components as ComponentHandler[]));
  }
  return components;
}

function handlerModules(dir: string): Array<[string, { handlers?: unknown; components?: unknown }]> {
  return readdirSync(dir)
    .filter(isHandlerFile)
    .sort()
    .map((file) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- discovery by file is the point (docs/04 « Règles » 5)
      const exported = require(join(dir, file)) as { handlers?: unknown; components?: unknown };
      return [file, exported];
    });
}

/** Routes slash commands, autocomplete and message components (menus, buttons) to their handlers. */
export class CommandRegistry {
  private readonly logger = new Logger(CommandRegistry.name);
  private readonly byKey = new Map<string, CommandHandler>();
  private readonly declared: string[];
  private readonly byCustomId = new Map<string, ComponentHandler>();

  constructor(
    handlers: readonly CommandHandler[],
    declaredKeys: readonly string[] = commandKeys(),
    components: readonly ComponentHandler[] = [],
  ) {
    this.declared = [...declaredKeys];
    for (const component of components) {
      if (this.byCustomId.has(component.customId)) throw new Error(`Two component handlers for "${component.customId}"`);
      this.byCustomId.set(component.customId, component);
    }
    for (const handler of handlers) {
      if (!this.declared.includes(handler.key)) {
        throw new Error(`Handler "${handler.key}" matches no command of command-definitions.ts`);
      }
      if (this.byKey.has(handler.key)) throw new Error(`Two handlers for "${handler.key}"`);
      this.byKey.set(handler.key, handler);
    }
  }

  /** Declared commands that still answer « Bientôt disponible ». */
  pendingKeys(): string[] {
    return this.declared.filter((key) => !this.byKey.has(key));
  }

  async handle(interaction: Interaction, ctx: CommandContext): Promise<void> {
    if (interaction.isChatInputCommand()) {
      const key = interactionKey(interaction);
      const handler = this.byKey.get(key);
      try {
        if (!handler) {
          await interaction.reply({ content: MSG.comingSoon, flags: MessageFlags.Ephemeral });
          return;
        }
        await handler.execute(interaction, ctx);
      } catch (error) {
        this.logger.error(`/${key} failed: ${describe(error)}`);
        await this.replyError(interaction, key);
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const key = interactionKey(interaction);
      try {
        const handler = this.byKey.get(key);
        if (handler?.autocomplete) await handler.autocomplete(interaction, ctx);
        else await interaction.respond([]);
      } catch (error) {
        this.logger.error(`/${key} autocomplete failed: ${describe(error)}`);
      }
      return;
    }

    if (interaction.isMessageComponent()) {
      const handler = this.byCustomId.get(interaction.customId);
      try {
        if (!handler) {
          await interaction.reply({ content: MSG.componentExpired, flags: MessageFlags.Ephemeral });
          return;
        }
        await handler.execute(interaction, ctx);
      } catch (error) {
        this.logger.error(`Component ${interaction.customId} failed: ${describe(error)}`);
        await this.replyError(interaction, interaction.customId);
      }
    }
  }

  private async replyError(interaction: ChatInputCommandInteraction | MessageComponentInteraction, key: string): Promise<void> {
    try {
      if (interaction.deferred) await interaction.editReply({ content: MSG.genericError });
      else if (interaction.replied) await interaction.followUp({ content: MSG.genericError, flags: MessageFlags.Ephemeral });
      else await interaction.reply({ content: MSG.genericError, flags: MessageFlags.Ephemeral });
    } catch (error) {
      this.logger.error(`/${key}: could not send the error reply: ${describe(error)}`);
    }
  }
}

/** Error text for logs: message only, never the interaction (it carries a token). */
function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
