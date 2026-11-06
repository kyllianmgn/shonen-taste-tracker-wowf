import { MessageFlags, TimestampStyles, time } from 'discord.js';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PAIRING_CODE_TTL_SEC, PairingService } from '../../ingest/pairing/pairing.service';
import { MSG } from '../messages';
import type { CommandHandler } from '../registry/command-handler';

/** /lier appli (docs/02 « Joueur »): ephemeral pairing code and download link. The logic lives in PairingService. */
export const handlers: CommandHandler[] = [
  {
    key: 'lier appli',
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { code, expiresAt } = await ctx.get(PairingService).issueCode({
        discordUserId: interaction.user.id,
        guildId: interaction.guildId,
      });
      const { appDownloadUrl } = ctx.get<AppConfig>(APP_CONFIG);
      await interaction.editReply({ content: formatLierAppliReply(code, expiresAt, appDownloadUrl) });
    },
  },
];

export function formatLierAppliReply(code: string, expiresAt: Date, downloadUrl: string): string {
  const minutes = PAIRING_CODE_TTL_SEC / 60;
  return [
    '🔗 **Relier l’appli ForeverTracker**',
    `Ton code : \`${code}\``,
    `Saisis-le dans l’appli dans les ${minutes} minutes (expire ${time(expiresAt, TimestampStyles.RelativeTime)}). Il ne sert qu’une seule fois.`,
    `Pas encore l’appli ? Télécharge-la ici : ${downloadUrl}`,
    'Ne partage pas ce code : il permet d’envoyer des données en ton nom.',
  ].join('\n');
}
