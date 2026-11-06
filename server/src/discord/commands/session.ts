import { PROFILE_MSG, publicReply } from '../profile/profile-replies';
import { ProfileQueryService } from '../profile/profile-query.service';
import { startPublic } from '../profile/start-public';
import { renderSession } from '../render/profile';
import type { CommandHandler } from '../registry/command-handler';

/** /session [membre] (docs/02 « Joueur »): recap of the session in progress or the last ended one. */
export const handlers: CommandHandler[] = [
  {
    key: 'session',
    async execute(interaction, ctx) {
      if (!(await startPublic(interaction))) return;
      const targetId = interaction.options.getUser('membre')?.id ?? interaction.user.id;
      const query = ctx.get(ProfileQueryService);
      if (!(await query.isMember(interaction.guildId!, targetId))) {
        await interaction.editReply(publicReply(PROFILE_MSG.notMember(targetId)));
        return;
      }
      const now = new Date();
      const session = await query.session(targetId, now);
      await interaction.editReply(publicReply(session ? renderSession(session, now) : PROFILE_MSG.noSession(targetId)));
    },
  },
];
