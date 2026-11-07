import { escapeMarkdown } from 'discord.js';
import { ROLE_LABELS } from '../../core/characters/character-pick';
import type { AddCharacterResult, CharacterName, OwnedCharacter } from '../../core/characters/character.types';
import { PERSO_MSG } from '../perso/perso-replies';
import type { BoardSort } from '../render/board';

/** French replies of /config and /admin (pure functions, docs/03 « Langue du bot »). */

/** The guild_config columns /config changes, plus the board channel for /admin rafraichir. */
export interface GuildSettings {
  levelAnnounceStep: number;
  logDeaths: boolean;
  boardSort: BoardSort;
  boardChannelId: string | null;
}
export type GuildSettingsPatch = Partial<Pick<GuildSettings, 'levelAnnounceStep' | 'logDeaths' | 'boardSort'>>;

export const ADMIN_MSG = {
  refreshQueued: '🔄 Le tableau va être supprimé puis republié dans quelques secondes.',
  noBoard: '❌ Ce serveur n’a pas de tableau. Lance /setup d’abord.',
  botMember: '❌ Un bot ne peut pas avoir de perso.',
} as const;

const SORT_LABELS: Record<BoardSort, string> = { level: 'niveau', played: 'temps joué', name: 'nom' };

const announceLabel = (step: number) => (step <= 1 ? 'chaque niveau' : `tous les ${step} niveaux`);

export function configReply(settings: Omit<GuildSettings, 'boardChannelId'>, changed: boolean): string {
  const lines = [
    changed ? '✅ Réglages mis à jour.' : '**Réglages du serveur**',
    `⬆️ Annonce des niveaux : ${announceLabel(settings.levelAnnounceStep)}`,
    `💀 Morts dans les logs : ${settings.logDeaths ? 'oui' : 'non'}`,
    `📋 Tri du tableau : ${SORT_LABELS[settings.boardSort]}`,
  ];
  if (!changed) lines.push('Change-les avec /config annonce_niveau:… morts:… tri:…');
  return lines.join('\n');
}

const show = (c: CharacterName) => `**${escapeMarkdown(`${c.firstName} ${c.surname}`)}** (${c.region.toUpperCase()})`;
const showWithRole = (c: OwnedCharacter) =>
  `**${escapeMarkdown(`${c.firstName} ${c.surname}`)}** (${c.region.toUpperCase()}, ${ROLE_LABELS[c.role]})`;

/** Like addReply of /perso ajouter, about another member. Send with no allowed mention. */
export function adminAddReply(memberId: string, result: AddCharacterResult): string {
  const member = `<@${memberId}>`;
  switch (result.status) {
    case 'added':
      return `✅ ${show(result.character)} est maintenant le perso ${ROLE_LABELS[result.role]} de ${member}.`;
    case 'already_tracked':
      return `ℹ️ ${show(result.character)} est déjà le perso ${ROLE_LABELS[result.role]} de ${member}.`;
    case 'owned_by_other':
      return `❌ ${show(result.character)} appartient déjà à un autre membre.`;
    case 'role_taken':
      return `❌ ${member} a déjà un perso ${ROLE_LABELS[result.role]} : ${show(result.holder)}. Ajoute ${show(result.character)} dans l’autre rôle.`;
    case 'too_many':
      return `❌ ${member} suit déjà 2 persos, le maximum : ${result.tracked.map(showWithRole).join(' et ')}.`;
    case 'invalid_name':
      return PERSO_MSG.invalidName;
  }
}

interface SuspectBase {
  /** Snapshot: received_at. Event: at. */
  at: Date;
  character: CharacterName;
  ownerId: string | null;
  flags: string[];
}
export type SuspectItem =
  | (SuspectBase & { kind: 'snapshot'; level: number })
  | (SuspectBase & { kind: 'event'; type: string });

/** Discord's message limit. */
export const SUSPECTS_MAX_CHARS = 2000;

const FLAG_LABELS: Record<string, string> = {
  suspect_level_jump: 'saut de niveau suspect',
  future_timestamp: 'date dans le futur',
  level_above_cap: 'niveau au-dessus du plafond',
  regression: 'régression',
};

function suspectLine(item: SuspectItem): string {
  const parts = [
    `${item.kind === 'snapshot' ? '📸' : '📜'} <t:${Math.floor(item.at.getTime() / 1000)}:f>`,
    show(item.character),
    item.ownerId ? `<@${item.ownerId}>` : 'sans propriétaire',
    // Event types and flags are server-side or contract enums: plain words, nothing to escape.
    item.kind === 'snapshot' ? `niveau ${item.level}` : item.type,
    item.flags.map((f) => FLAG_LABELS[f] ?? f).join(', '),
  ];
  return parts.join(' · ');
}

/** /admin suspects, newest first as given; lines that do not fit are counted at the end. */
export function suspectsReply(items: readonly SuspectItem[]): string {
  if (items.length === 0) return '✅ Aucune donnée signalée ces 7 derniers jours.';
  const lines = ['**Données signalées (7 derniers jours)**'];
  let length = lines[0].length;
  for (const [index, item] of items.entries()) {
    const line = suspectLine(item);
    const remaining = items.length - index;
    // Room for this line, plus the « … et N de plus. » footer if more lines follow.
    const footer = remaining > 1 ? `\n… et ${remaining - 1} de plus.`.length : 0;
    if (length + 1 + line.length + footer > SUSPECTS_MAX_CHARS) {
      lines.push(`… et ${remaining} de plus.`);
      break;
    }
    lines.push(line);
    length += 1 + line.length;
  }
  return lines.join('\n');
}
