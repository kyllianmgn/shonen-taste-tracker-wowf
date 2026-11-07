import { parseRegion } from '../../core/characters/character-name';
import { CharacterService } from '../../core/characters/character.service';
import type { TrackedRole } from '../../core/characters/character.types';
import { startAdmin } from '../admin/admin-guard';
import { ADMIN_MSG, adminAddReply, suspectsReply } from '../admin/admin-replies';
import { GuildSettingsService } from '../admin/guild-settings.service';
import { SuspectsQueryService } from '../admin/suspects-query.service';
import { BoardPublisher } from '../board/board-publisher';
import type { CommandHandler } from '../registry/command-handler';

/** /admin suspects looks back this far. */
const SUSPECTS_WINDOW_MS = 7 * 24 * 3600 * 1000;

const asRole = (value: string | null): TrackedRole | undefined =>
  value === 'main' || value === 'alt' ? value : undefined;

/** /admin perso, rafraichir, suspects (docs/02 « Admin », Manage Server). */
export const handlers: CommandHandler[] = [
  {
    key: 'admin perso',
    async execute(interaction, ctx) {
      if (!(await startAdmin(interaction))) return;
      const member = interaction.options.getUser('membre', true);
      if (member.bot) {
        await interaction.editReply({ content: ADMIN_MSG.botMember });
        return;
      }
      const result = await ctx.get(CharacterService).add({
        ownerId: member.id,
        guildId: interaction.guildId!,
        region: parseRegion(interaction.options.getString('region')) ?? 'eu',
        firstName: interaction.options.getString('prenom', true),
        surname: interaction.options.getString('nom', true),
        role: asRole(interaction.options.getString('role')),
      });
      // The member may now be shown on this server's board.
      await ctx.get(BoardPublisher).markPlayerDirty(member.id);
      await interaction.editReply({ content: adminAddReply(member.id, result), allowedMentions: { parse: [] } });
    },
  },
  {
    key: 'admin rafraichir',
    async execute(interaction, ctx) {
      if (!(await startAdmin(interaction))) return;
      const guildId = interaction.guildId!;
      const { boardChannelId } = await ctx.get(GuildSettingsService).get(guildId);
      if (!boardChannelId) {
        await interaction.editReply({ content: ADMIN_MSG.noBoard });
        return;
      }
      ctx.get(BoardPublisher).republish(guildId);
      await interaction.editReply({ content: ADMIN_MSG.refreshQueued });
    },
  },
  {
    key: 'admin suspects',
    async execute(interaction, ctx) {
      if (!(await startAdmin(interaction))) return;
      const since = new Date(Date.now() - SUSPECTS_WINDOW_MS);
      const items = await ctx.get(SuspectsQueryService).list(interaction.guildId!, since);
      await interaction.editReply({ content: suspectsReply(items), allowedMentions: { parse: [] } });
    },
  },
];
