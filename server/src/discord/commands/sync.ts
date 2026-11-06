import { MessageFlags } from 'discord.js';
import { ManualSyncService, type ManualSyncInput } from '../../ingest/share-code/manual-sync.service';
import { MSG } from '../messages';
import type { CommandHandler } from '../registry/command-handler';
import { downloadAttachment } from '../sync/attachment-download';
import { renderManualSyncReply, SYNC_MSG } from '../sync/sync-replies';

/**
 * /sync (docs/02 « Commande /sync »): manual send of the base mode, `code` or `fichier`, ephemeral.
 * Decoding, rate limit and ingestion live in ManualSyncService.
 */
export const handlers: CommandHandler[] = [
  {
    key: 'sync',
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }

      const code = interaction.options.getString('code');
      const attachment = interaction.options.getAttachment('fichier');
      // Exactly one of the two; a wrong call is not an attempt and does not use the 2-minute slot.
      if ((code === null) === (attachment === null)) {
        await interaction.reply({ content: SYNC_MSG.usage, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const input: ManualSyncInput =
        code !== null
          ? { kind: 'code', text: code }
          : { kind: 'file', load: () => downloadAttachment({ url: attachment!.url, size: attachment!.size }) };
      const outcome = await ctx.get(ManualSyncService).run({ ownerId: interaction.user.id, guildId: interaction.guildId, input });
      await interaction.editReply({ content: renderManualSyncReply(outcome) });
    },
  },
];
