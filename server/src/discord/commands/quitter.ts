import { MessageFlags } from 'discord.js';
import { PlayerAccountService } from '../../core/players/player-account.service';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import { QUIT_CONFIRM_TTL_MS, QUIT_IDS, QUIT_MSG, quitPrompt } from '../privacy/privacy-replies';
import type { CommandHandler, ComponentHandler } from '../registry/command-handler';

/**
 * /quitter (docs/02 « Joueur », « Modèle de données »): an ephemeral prompt with a confirmation
 * button valid 60 s, then PlayerAccountService.quit. The prompt is ephemeral, so only its author
 * can click it; its age is read from the message itself, nothing is kept in memory.
 */
export const handlers: CommandHandler[] = [
  {
    key: 'quitter',
    async execute(interaction) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ ...quitPrompt(new Date()), flags: MessageFlags.Ephemeral });
    },
  },
];

export const components: ComponentHandler[] = [
  {
    customId: QUIT_IDS.confirm,
    async execute(interaction, ctx) {
      if (Date.now() - interaction.message.createdTimestamp > QUIT_CONFIRM_TTL_MS) {
        await interaction.update({ content: QUIT_MSG.expired, components: [] });
        return;
      }
      await interaction.deferUpdate();
      const result = await ctx.get(PlayerAccountService).quit(interaction.user.id);
      const publisher = ctx.get(BoardPublisher);
      for (const guildId of result.guildIds) publisher.markDirty(guildId);
      await interaction.editReply({ content: result.deleted ? QUIT_MSG.done : QUIT_MSG.nothing, components: [] });
    },
  },
  {
    customId: QUIT_IDS.cancel,
    async execute(interaction) {
      await interaction.update({ content: QUIT_MSG.cancelled, components: [] });
    },
  },
];
