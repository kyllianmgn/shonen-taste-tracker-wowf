import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import { REGIONS, type AppConfig, type Region } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { CharacterService } from '../../core/characters/character.service';
import { BNET_SELECT_IDS, setAltReply } from '../bnet-link/bnet-link-replies';
import { startBnetLink } from '../bnet-link/start-bnet-link';
import { MSG } from '../messages';
import { PERSO_MSG, setMainReply } from '../perso/perso-replies';
import type { CommandHandler, ComponentHandler } from '../registry/command-handler';

/**
 * /lier battlenet (docs/02 « Liaison Battle.net » step 1) and the two menus of its result
 * (step 6). The callback itself lives in bnet/oauth.
 */
export const handlers: CommandHandler[] = [
  {
    key: 'lier battlenet',
    async execute(interaction, ctx) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const region = asRegion(interaction.options.getString('region')) ?? ctx.get<AppConfig>(APP_CONFIG).bnetDefaultRegion;
      await startBnetLink(interaction, ctx, region);
    },
  },
];

export const components: ComponentHandler[] = [
  {
    customId: BNET_SELECT_IDS.main,
    async execute(interaction, ctx) {
      await choose(interaction, async (id) => setMainReply(await ctx.get(CharacterService).setMain(interaction.user.id, id)));
    },
  },
  {
    customId: BNET_SELECT_IDS.alt,
    async execute(interaction, ctx) {
      await choose(interaction, async (id) => setAltReply(await ctx.get(CharacterService).setAlt(interaction.user.id, id)));
    },
  },
];

/**
 * The menus work from the ephemeral reply or from the DM: only the member's own characters are
 * found by CharacterService, whatever value comes back.
 */
async function choose(
  interaction: MessageComponentInteraction,
  apply: (characterId: bigint) => Promise<string>,
): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = characterId(interaction.values[0]);
  await interaction.editReply({ content: id === null ? PERSO_MSG.notFound : await apply(id) });
}

function characterId(value: string | undefined): bigint | null {
  return value !== undefined && /^\d{1,19}$/.test(value) ? BigInt(value) : null;
}

/** Discord only sends the declared choices; anything else falls back to BNET_DEFAULT_REGION. */
function asRegion(value: string | null): Region | null {
  return value !== null && (REGIONS as readonly string[]).includes(value) ? (value as Region) : null;
}
