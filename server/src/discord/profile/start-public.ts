import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { MSG } from '../messages';

/** Public deferred reply in a guild; false when the command was used elsewhere (already answered). */
export async function startPublic(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    return false;
  }
  await interaction.deferReply();
  return true;
}
