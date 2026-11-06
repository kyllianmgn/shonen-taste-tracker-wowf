import type { InteractionEditReplyOptions } from 'discord.js';
import { OauthStateService } from '../../bnet/oauth/oauth-state.service';
import type { Region } from '../../common/config/config';
import type { CommandContext } from '../registry/command-handler';
import { renderLierBattlenetReply } from './bnet-link-replies';

/** A deferred guild interaction: the slash command or the « Relier Battle.net » button. */
export interface LinkStarter {
  user: { id: string };
  guildId: string;
  token: string;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

/**
 * docs/02 « Flux » step 1: a state tied to the member, the server and this interaction's token
 * (the callback edits this reply), then the ephemeral reply with the Battle.net link.
 */
export async function startBnetLink(interaction: LinkStarter, ctx: CommandContext, region: Region): Promise<void> {
  const { url, expiresAt } = await ctx.get(OauthStateService).issue({
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    region,
    interactionToken: interaction.token,
  });
  await interaction.editReply(renderLierBattlenetReply(url, region, expiresAt));
}
