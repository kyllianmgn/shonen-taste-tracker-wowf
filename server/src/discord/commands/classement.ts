import { publicReply } from '../profile/profile-replies';
import { ProfileQueryService } from '../profile/profile-query.service';
import { startPublic } from '../profile/start-public';
import { renderLeaderboard, type LeaderboardCriterion } from '../render/profile';
import type { CommandHandler } from '../registry/command-handler';

const CRITERIA: readonly LeaderboardCriterion[] = ['level', 'played', 'pace', 'money', 'deaths'];

const asCriterion = (value: string | null): LeaderboardCriterion =>
  CRITERIA.find((c) => c === value) ?? 'level';

/** /classement [critere] (docs/02 « Joueur »): top 15 of the server's members, main characters. */
export const handlers: CommandHandler[] = [
  {
    key: 'classement',
    async execute(interaction, ctx) {
      if (!(await startPublic(interaction))) return;
      const criterion = asCriterion(interaction.options.getString('critere'));
      const entries = await ctx.get(ProfileQueryService).leaderboard(interaction.guildId!);
      await interaction.editReply(publicReply(renderLeaderboard({ criterion, entries })));
    },
  },
];
