import { MessageFlags } from 'discord.js';
import { PlayerAccountService, type PrivacyPatch } from '../../core/players/player-account.service';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import { privacyReply } from '../privacy/privacy-replies';
import type { CommandHandler } from '../registry/command-handler';

/** Option name → player column. */
const OPTIONS = { or: 'hideMoney', zone: 'hideZone', presence: 'hidePresence' } as const;

/** /confidentialite (docs/02 « Joueur »): without options shows the settings, otherwise changes them. */
export const handlers: CommandHandler[] = [
  {
    key: 'confidentialite',
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const patch: PrivacyPatch = {};
      for (const [option, column] of Object.entries(OPTIONS)) {
        const value = interaction.options.getBoolean(option);
        if (value !== null) patch[column] = value;
      }
      const accounts = ctx.get(PlayerAccountService);
      if (Object.keys(patch).length === 0) {
        await interaction.editReply({ content: privacyReply(await accounts.getPrivacy(interaction.user.id), false) });
        return;
      }

      const privacy = await accounts.setPrivacy(interaction.user.id, patch);
      await ctx.get(BoardPublisher).markPlayerDirty(interaction.user.id);
      await interaction.editReply({ content: privacyReply(privacy, true) });
    },
  },
];
