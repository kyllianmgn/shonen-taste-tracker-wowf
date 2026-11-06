import {
  ApplicationCommandOptionType,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';

/**
 * Every slash command of docs/02 « Commandes Discord », registered in one batch at startup.
 * Handlers live in ../commands/ (one file per command) and are matched by key, see command-handler.ts.
 */

const REGION_CHOICES = [
  { name: 'EU', value: 'eu' },
  { name: 'US', value: 'us' },
  { name: 'KR', value: 'kr' },
  { name: 'TW', value: 'tw' },
];
const ROLE_CHOICES = [
  { name: 'principal', value: 'main' },
  { name: 'secondaire', value: 'alt' },
];

const command = (name: string, description: string) =>
  new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild);
const admin = (name: string, description: string) =>
  command(name, description).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

/** Options shared by /perso ajouter and /admin perso. */
const characterOptions = (s: SlashCommandSubcommandBuilder) =>
  s
    // 2-12 characters, as the contract and the game (docs/02 « Règles de validation »).
    .addStringOption((o) =>
      o.setName('prenom').setDescription('Prénom du perso').setRequired(true).setMinLength(2).setMaxLength(12),
    )
    .addStringOption((o) =>
      o.setName('nom').setDescription('Nom de famille du perso').setRequired(true).setMinLength(2).setMaxLength(12),
    )
    .addStringOption((o) => o.setName('region').setDescription('Région du compte (EU par défaut)').addChoices(...REGION_CHOICES))
    .addStringOption((o) => o.setName('role').setDescription('Perso principal ou secondaire').addChoices(...ROLE_CHOICES));

const characterPick = (o: SlashCommandStringOption, description: string, required: boolean) =>
  o.setName('perso').setDescription(description).setRequired(required).setAutocomplete(true);

const builders = [
  // --- Player -------------------------------------------------------------
  command('lier', 'Relier ton compte au bot')
    .addSubcommand((s) => s.setName('appli').setDescription("Obtenir un code d'appairage pour l'appli compagnon"))
    .addSubcommand((s) => s.setName('battlenet').setDescription('Relier ton compte Battle.net')),

  command('perso', 'Gérer tes persos suivis')
    .addSubcommand((s) => characterOptions(s.setName('ajouter').setDescription('Ajouter un perso à suivre')))
    .addSubcommand((s) =>
      s
        .setName('principal')
        .setDescription('Faire de ce perso ton principal')
        .addStringOption((o) => characterPick(o, 'Perso à passer en principal', true)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Arrêter de suivre un perso')
        .addStringOption((o) => characterPick(o, 'Perso à retirer', true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Voir tes persos suivis')),

  command('profil', "Fiche d'un perso")
    .addUserOption((o) => o.setName('membre').setDescription('Membre à afficher (toi par défaut)'))
    .addStringOption((o) => characterPick(o, 'Perso à afficher (le principal par défaut)', false)),

  command('session', 'Récap de la dernière session de jeu').addUserOption((o) =>
    o.setName('membre').setDescription('Membre à afficher (toi par défaut)'),
  ),

  command('classement', 'Top 15 des membres du serveur').addStringOption((o) =>
    o
      .setName('critere')
      .setDescription('Critère du classement (niveau par défaut)')
      .addChoices(
        { name: 'niveau', value: 'level' },
        { name: 'temps joué', value: 'played' },
        { name: 'rythme', value: 'pace' },
        { name: 'or', value: 'money' },
        { name: 'morts', value: 'deaths' },
      ),
  ),

  command('confidentialite', 'Masquer certaines de tes infos partout')
    .addBooleanOption((o) => o.setName('or').setDescription('Masquer ton or'))
    .addBooleanOption((o) => o.setName('zone').setDescription('Masquer ta zone'))
    .addBooleanOption((o) => o.setName('presence').setDescription('Masquer ton statut en ligne')),

  command('quitter', 'Supprimer toutes tes données du bot'),

  command('sync', 'Envoyer tes données sans l’appli (mode de base)')
    .addStringOption((o) => o.setName('code').setDescription('Texte donné par /ftr share dans le jeu'))
    .addAttachmentOption((o) => o.setName('fichier').setDescription('Ton fichier ForeverTracker.lua')),

  // --- Admin (Manage Server) ---------------------------------------------
  admin('setup', 'Créer ou choisir les salons du tableau et des logs')
    .addChannelOption((o) =>
      o.setName('tableau').setDescription('Salon du tableau (créé si absent)').addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((o) =>
      o.setName('logs').setDescription('Salon des logs (créé si absent)').addChannelTypes(ChannelType.GuildText),
    ),

  admin('config', 'Réglages du bot sur ce serveur')
    .addIntegerOption((o) =>
      o
        .setName('annonce_niveau')
        .setDescription('Annoncer les niveaux dans les logs')
        .addChoices(
          { name: 'chaque niveau', value: 1 },
          { name: 'tous les 5 niveaux', value: 5 },
          { name: 'tous les 10 niveaux', value: 10 },
        ),
    )
    .addBooleanOption((o) => o.setName('morts').setDescription('Annoncer les morts dans les logs'))
    .addStringOption((o) =>
      o
        .setName('tri')
        .setDescription('Ordre du tableau')
        .addChoices(
          { name: 'niveau', value: 'level' },
          { name: 'temps', value: 'played' },
          { name: 'nom', value: 'name' },
        ),
    ),

  admin('admin', 'Outils des admins')
    .addSubcommand((s) =>
      characterOptions(
        s
          .setName('perso')
          .setDescription('Ajouter un perso pour un autre membre')
          .addUserOption((o) => o.setName('membre').setDescription('Membre propriétaire du perso').setRequired(true)),
      ),
    )
    .addSubcommand((s) => s.setName('rafraichir').setDescription('Supprimer et republier le tableau'))
    .addSubcommand((s) => s.setName('suspects').setDescription('Données signalées des 7 derniers jours')),
];

export const COMMAND_DEFINITIONS: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] = builders.map((b) =>
  b.toJSON(),
);

/** Handler keys: `name`, `name sub` or `name group sub` for each leaf command. */
export function commandKeys(definitions = COMMAND_DEFINITIONS): string[] {
  const keys: string[] = [];
  for (const def of definitions) {
    const subs = (def.options ?? []).filter(
      (o) =>
        o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup,
    );
    if (subs.length === 0) {
      keys.push(def.name);
      continue;
    }
    for (const s of subs) {
      if (s.type === ApplicationCommandOptionType.SubcommandGroup) {
        for (const leaf of s.options ?? []) keys.push(`${def.name} ${s.name} ${leaf.name}`);
      } else {
        keys.push(`${def.name} ${s.name}`);
      }
    }
  }
  return keys;
}
