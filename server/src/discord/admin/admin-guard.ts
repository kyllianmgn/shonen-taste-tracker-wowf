import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { MSG } from '../messages';

/**
 * In a guild, with Manage Server: defers an ephemeral reply and returns true. Otherwise answers
 * and returns false. default_member_permissions hides admin commands, but server admins can
 * override it, so the permission is checked again here (docs/02 « Admin »).
 */
export async function startAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    return false;
  }
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: MSG.manageGuildRequired, flags: MessageFlags.Ephemeral });
    return false;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return true;
}
