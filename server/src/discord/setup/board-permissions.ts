import { OverwriteType, PermissionFlagsBits as P } from 'discord.js';

/**
 * Permissions that /setup puts on the board channel (docs/02 « Admin »): nobody but the bot can
 * write, start threads or react there.
 */
export const BOARD_EVERYONE_DENY: readonly bigint[] = [
  P.SendMessages,
  P.SendMessagesInThreads,
  P.CreatePublicThreads,
  P.CreatePrivateThreads,
  P.AddReactions,
];

/** What the bot itself needs in the board channel to publish and edit the board. */
export const BOARD_BOT_ALLOW: readonly bigint[] = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];

/** What the bot needs in the logs channel to post log messages. */
export const LOGS_BOT_REQUIRED: readonly bigint[] = [P.ViewChannel, P.SendMessages, P.EmbedLinks];

export interface OverwriteSpec {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

const union = (flags: readonly bigint[]): bigint => flags.reduce((acc, flag) => acc | flag, 0n);

/** Overwrites set when the bot creates the board channel. */
export function boardOverwrites(everyoneRoleId: string, botUserId: string): OverwriteSpec[] {
  return [
    { id: everyoneRoleId, type: OverwriteType.Role, allow: 0n, deny: union(BOARD_EVERYONE_DENY) },
    { id: botUserId, type: OverwriteType.Member, allow: union(BOARD_BOT_ALLOW), deny: 0n },
  ];
}

/**
 * Server-level permissions the bot needs for /setup. Discord only lets a bot put in a new channel's
 * overwrites the permissions it holds itself, so creating the board needs all of them.
 */
export function requiredGuildPermissions(opts: { createsBoard: boolean }): bigint[] {
  if (!opts.createsBoard) return [P.ManageChannels];
  return [...new Set([P.ManageChannels, ...BOARD_EVERYONE_DENY, ...BOARD_BOT_ALLOW])];
}

/** Flags of `required` that `have` lacks, in the order of `required`. */
export function missingFlags(have: bigint, required: readonly bigint[]): bigint[] {
  return required.filter((flag) => (have & flag) !== flag);
}

/** Names shown by the French Discord client. */
const LABELS = new Map<bigint, string>([
  [P.ManageChannels, 'Gérer les salons'],
  [P.ViewChannel, 'Voir les salons'],
  [P.SendMessages, 'Envoyer des messages'],
  [P.SendMessagesInThreads, 'Envoyer des messages dans les fils'],
  [P.CreatePublicThreads, 'Créer des fils publics'],
  [P.CreatePrivateThreads, 'Créer des fils privés'],
  [P.AddReactions, 'Ajouter des réactions'],
  [P.EmbedLinks, 'Intégrer des liens'],
  [P.ReadMessageHistory, 'Voir les anciens messages'],
  [P.ManageGuild, 'Gérer le serveur'],
]);

export function permissionLabels(flags: readonly bigint[]): string {
  return flags.map((flag) => `« ${LABELS.get(flag) ?? `permission inconnue ${flag}`} »`).join(', ');
}
