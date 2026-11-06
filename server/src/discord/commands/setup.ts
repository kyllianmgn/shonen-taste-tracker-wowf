import { DiscordAPIError, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import type { CommandHandler } from '../registry/command-handler';
import { createSetupGuild } from '../setup/discord-setup-guild';
import { SetupService, formatSetupReply } from '../setup/setup.service';

/** /setup (docs/02 « Admin »). The logic lives in SetupService; this file only adapts the interaction. */
export const handlers: CommandHandler[] = [
  {
    key: 'setup',
    async execute(interaction, ctx) {
      if (!interaction.inCachedGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }
      // default_member_permissions can be overridden by server admins; the spec requires Manage Server.
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: MSG.manageGuildRequired, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const outcome = await ctx.get(SetupService).run(await createSetupGuild(interaction.guild), {
          boardChannelId: interaction.options.getChannel('tableau')?.id,
          logsChannelId: interaction.options.getChannel('logs')?.id,
        });
        // The board now shows the provisional message: have the publisher draw the real one.
        if (outcome.ok) ctx.get(BoardPublisher).invalidate(interaction.guild.id);
        await interaction.editReply({ content: formatSetupReply(outcome) });
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.MissingPermissions) {
          await interaction.editReply({ content: MSG.missingPermissions });
          return;
        }
        throw error;
      }
    },
  },
];
