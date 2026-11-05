import type { Type } from '@nestjs/common';
import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';

/** Access to Nest providers from a command handler (handler files are not Nest providers themselves). */
export interface CommandContext {
  get<T>(token: Type<T> | string | symbol): T;
}

/**
 * One file per command in ../commands/, exporting `handlers: CommandHandler[]`; the registry finds
 * them on its own (docs/04 « Règles » 5). `key` is a leaf of command-definitions.ts: `name`,
 * `name sub` or `name group sub`. Commands without handler answer « Bientôt disponible ».
 */
export interface CommandHandler {
  readonly key: string;
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, ctx: CommandContext): Promise<void>;
}

interface KeyedInteraction {
  commandName: string;
  options: { getSubcommandGroup(required?: boolean): string | null; getSubcommand(required?: boolean): string | null };
}

export function interactionKey(interaction: KeyedInteraction): string {
  return [
    interaction.commandName,
    interaction.options.getSubcommandGroup(false),
    interaction.options.getSubcommand(false),
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}
