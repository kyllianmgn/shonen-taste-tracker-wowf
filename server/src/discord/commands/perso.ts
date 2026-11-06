import { MessageFlags, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { characterChoices, resolveCharacterPick, type PickMode } from '../../core/characters/character-pick';
import { parseRegion } from '../../core/characters/character-name';
import { CharacterService } from '../../core/characters/character.service';
import type { OwnedCharacter, TrackedRole } from '../../core/characters/character.types';
import { MSG } from '../messages';
import { addReply, listReply, PERSO_MSG, setMainReply, untrackReply } from '../perso/perso-replies';
import type { CommandContext, CommandHandler } from '../registry/command-handler';

/** /perso ajouter, principal, retirer, liste (docs/02 « Joueur »). Rules live in CharacterService. */

/** Ephemeral deferred reply in a guild; false when the command was used elsewhere (already answered). */
async function start(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    return false;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return true;
}

const asRole = (value: string | null): TrackedRole | undefined =>
  value === 'main' || value === 'alt' ? value : undefined;

/** Resolves the `perso` option among the member's characters, or answers « introuvable ». */
async function pick(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<OwnedCharacter | null> {
  const mine = await ctx.get(CharacterService).list(interaction.user.id);
  const character = resolveCharacterPick(interaction.options.getString('perso', true), mine);
  if (!character) await interaction.editReply({ content: PERSO_MSG.notFound });
  return character;
}

function autocompleteFor(mode: PickMode) {
  return async (interaction: AutocompleteInteraction, ctx: CommandContext): Promise<void> => {
    if (!interaction.inGuild()) {
      await interaction.respond([]);
      return;
    }
    const mine = await ctx.get(CharacterService).list(interaction.user.id);
    await interaction.respond(characterChoices(mine, mode, interaction.options.getFocused()));
  };
}

export const handlers: CommandHandler[] = [
  {
    key: 'perso ajouter',
    async execute(interaction, ctx) {
      if (!(await start(interaction))) return;
      const role = asRole(interaction.options.getString('role'));
      const result = await ctx.get(CharacterService).add({
        ownerId: interaction.user.id,
        guildId: interaction.guildId!,
        // Discord only sends the declared choices; anything else falls back to EU.
        region: parseRegion(interaction.options.getString('region')) ?? 'eu',
        firstName: interaction.options.getString('prenom', true),
        surname: interaction.options.getString('nom', true),
        role,
      });
      await interaction.editReply({ content: addReply(result, role) });
    },
  },
  {
    key: 'perso principal',
    async execute(interaction, ctx) {
      if (!(await start(interaction))) return;
      const character = await pick(interaction, ctx);
      if (!character) return;
      const result = await ctx.get(CharacterService).setMain(interaction.user.id, character.id);
      await interaction.editReply({ content: setMainReply(result) });
    },
    autocomplete: autocompleteFor('principal'),
  },
  {
    key: 'perso retirer',
    async execute(interaction, ctx) {
      if (!(await start(interaction))) return;
      const character = await pick(interaction, ctx);
      if (!character) return;
      const result = await ctx.get(CharacterService).untrack(interaction.user.id, character.id);
      await interaction.editReply({ content: untrackReply(result) });
    },
    autocomplete: autocompleteFor('retirer'),
  },
  {
    key: 'perso liste',
    async execute(interaction, ctx) {
      if (!(await start(interaction))) return;
      const characters = await ctx.get(CharacterService).list(interaction.user.id);
      await interaction.editReply({ content: listReply(characters) });
    },
  },
];
