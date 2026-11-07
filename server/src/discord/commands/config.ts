import { startAdmin } from '../admin/admin-guard';
import { configReply, type GuildSettingsPatch } from '../admin/admin-replies';
import { GuildSettingsService } from '../admin/guild-settings.service';
import { BoardPublisher } from '../board/board-publisher';
import type { BoardSort } from '../render/board';
import type { CommandHandler } from '../registry/command-handler';

const SORTS: readonly string[] = ['level', 'played', 'name'] satisfies BoardSort[];

/**
 * /config (docs/02 « Admin », Manage Server): without options shows the settings, otherwise
 * updates guild_config and has the board redrawn (announce step and deaths are read by the logs).
 */
export const handlers: CommandHandler[] = [
  {
    key: 'config',
    async execute(interaction, ctx) {
      if (!(await startAdmin(interaction))) return;
      const guildId = interaction.guildId!;

      const patch: GuildSettingsPatch = {};
      const step = interaction.options.getInteger('annonce_niveau');
      if (step !== null) patch.levelAnnounceStep = step;
      const deaths = interaction.options.getBoolean('morts');
      if (deaths !== null) patch.logDeaths = deaths;
      const sort = interaction.options.getString('tri');
      // Discord only sends the declared choices.
      if (sort !== null && SORTS.includes(sort)) patch.boardSort = sort as BoardSort;

      const settings = ctx.get(GuildSettingsService);
      if (Object.keys(patch).length === 0) {
        await interaction.editReply({ content: configReply(await settings.get(guildId), false) });
        return;
      }

      const updated = await settings.update(guildId, patch);
      ctx.get(BoardPublisher).markDirty(guildId);
      await interaction.editReply({ content: configReply(updated, true) });
    },
  },
];
