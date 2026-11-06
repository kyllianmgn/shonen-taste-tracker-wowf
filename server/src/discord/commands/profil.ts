import type { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js';
import { characterChoices, resolveCharacterPick } from '../../core/characters/character-pick';
import { CharacterService } from '../../core/characters/character.service';
import type { OwnedCharacter } from '../../core/characters/character.types';
import { PROFILE_MSG, publicReply } from '../profile/profile-replies';
import { ProfileQueryService } from '../profile/profile-query.service';
import { startPublic } from '../profile/start-public';
import { renderProfile } from '../render/profile';
import type { CommandContext, CommandHandler } from '../registry/command-handler';

/** /profil [membre] [perso] (docs/02 « Joueur »): public profile, the member's main by default. */

async function tracked(ctx: CommandContext, ownerId: string): Promise<OwnedCharacter[]> {
  const characters = await ctx.get(CharacterService).list(ownerId);
  return characters.filter((c) => c.role !== 'untracked');
}

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  if (!(await startPublic(interaction))) return;
  const targetId = interaction.options.getUser('membre')?.id ?? interaction.user.id;
  const query = ctx.get(ProfileQueryService);
  if (!(await query.isMember(interaction.guildId!, targetId))) {
    await interaction.editReply(publicReply(PROFILE_MSG.notMember(targetId)));
    return;
  }

  const characters = await tracked(ctx, targetId);
  const picked = interaction.options.getString('perso');
  const character = picked ? resolveCharacterPick(picked, characters) : (characters.find((c) => c.role === 'main') ?? null);
  if (!character) {
    await interaction.editReply(publicReply(picked ? PROFILE_MSG.characterNotFound : PROFILE_MSG.noMain(targetId)));
    return;
  }

  const input = await query.profile(targetId, character.id);
  await interaction.editReply(publicReply(input ? renderProfile(input) : PROFILE_MSG.characterNotFound));
}

/** The tracked characters of the `membre` already chosen (the caller by default). */
async function autocomplete(interaction: AutocompleteInteraction, ctx: CommandContext): Promise<void> {
  const raw = interaction.options.get('membre')?.value;
  const targetId = typeof raw === 'string' && raw !== '' ? raw : interaction.user.id;
  if (!interaction.inGuild() || !(await ctx.get(ProfileQueryService).isMember(interaction.guildId, targetId))) {
    await interaction.respond([]);
    return;
  }
  // 'retirer' offers exactly the tracked characters.
  await interaction.respond(characterChoices(await tracked(ctx, targetId), 'retirer', interaction.options.getFocused()));
}

export const handlers: CommandHandler[] = [{ key: 'profil', execute, autocomplete }];
