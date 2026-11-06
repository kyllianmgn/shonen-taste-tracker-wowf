import { escapeMarkdown } from 'discord.js';
import { ROLE_LABELS } from '../../core/characters/character-pick';
import type {
  AddCharacterResult,
  CharacterName,
  CharacterRole,
  OwnedCharacter,
  SetMainResult,
  TrackedRole,
  UntrackResult,
} from '../../core/characters/character.types';

/** French replies of /perso (pure functions, docs/03 « Langue du bot »). */

export const PERSO_MSG = {
  invalidName: '❌ Le prénom et le nom doivent faire chacun 2 à 12 lettres, sans espace, chiffre ni signe.',
  notFound: '❌ Perso introuvable parmi les tiens. Choisis-le dans la liste proposée, ou regarde /perso liste.',
  empty: 'Tu ne suis aucun perso. Ajoute-en un avec /perso ajouter.',
} as const;

const ROLE_ICONS: Record<CharacterRole, string> = { main: '⭐', alt: '🔹', untracked: '▫️' };

/** « **Prénom Nom** (EU) », names escaped since they may come from a sync. */
const show = (c: CharacterName) => `**${escapeMarkdown(`${c.firstName} ${c.surname}`)}** (${c.region.toUpperCase()})`;
const showWithRole = (c: OwnedCharacter) =>
  `**${escapeMarkdown(`${c.firstName} ${c.surname}`)}** (${c.region.toUpperCase()}, ${ROLE_LABELS[c.role]})`;
const trackedList = (tracked: OwnedCharacter[]) => tracked.map(showWithRole).join(' et ');
const tooMany = (tracked: OwnedCharacter[]) => `❌ Tu suis déjà 2 persos, le maximum : ${trackedList(tracked)}.`;

/** `asked` is the role option of the command, to point to /perso principal when it differs. */
export function addReply(result: AddCharacterResult, asked?: TrackedRole): string {
  switch (result.status) {
    case 'added':
      return `✅ ${show(result.character)} est maintenant ton perso ${ROLE_LABELS[result.role]}.`;
    case 'already_tracked': {
      const text = `ℹ️ ${show(result.character)} est déjà ton perso ${ROLE_LABELS[result.role]}.`;
      return asked === 'main' && result.role !== 'main' ? `${text} Pour en faire ton principal : /perso principal.` : text;
    }
    case 'owned_by_other':
      return `❌ ${show(result.character)} appartient déjà à un autre membre. Si c’est ton perso, contacte un admin du serveur.`;
    case 'role_taken':
      return result.role === 'main'
        ? `❌ Tu as déjà un perso principal : ${show(result.holder)}. Ajoute ${show(result.character)} en secondaire, puis utilise /perso principal pour échanger.`
        : `❌ Tu as déjà un perso secondaire : ${show(result.holder)}. Ajoute ${show(result.character)} en principal, ou retire d’abord ton secondaire avec /perso retirer.`;
    case 'too_many':
      return `${tooMany(result.tracked)} Retires-en un avec /perso retirer avant d’ajouter ${show(result.character)}.`;
    case 'invalid_name':
      return PERSO_MSG.invalidName;
  }
}

export function setMainReply(result: SetMainResult): string {
  switch (result.status) {
    case 'promoted': {
      const text = `⭐ ${show(result.character)} est maintenant ton perso principal.`;
      return result.demoted ? `${text} ${show(result.demoted)} passe en secondaire.` : text;
    }
    case 'already_main':
      return `ℹ️ ${show(result.character)} est déjà ton perso principal.`;
    case 'too_many':
      return `${tooMany(result.tracked)} Retire ton secondaire avec /perso retirer, puis relance /perso principal.`;
    case 'not_found':
      return PERSO_MSG.notFound;
  }
}

export function untrackReply(result: UntrackResult): string {
  switch (result.status) {
    case 'untracked':
      return `🗑️ ${show(result.character)} n’est plus suivi. Tu peux le reprendre avec /perso ajouter.`;
    case 'already_untracked':
      return `ℹ️ ${show(result.character)} n’est déjà plus suivi.`;
    case 'not_found':
      return PERSO_MSG.notFound;
  }
}

/** /perso liste: role, last sync as a Discord relative timestamp, Battle.net check. */
export function listReply(characters: readonly OwnedCharacter[]): string {
  if (characters.length === 0) return PERSO_MSG.empty;
  const lines = characters.map((c) => {
    const sync = c.lastSyncAt ? `dernière synchro <t:${Math.floor(c.lastSyncAt.getTime() / 1000)}:R>` : 'jamais synchronisé';
    const bnet = c.bnetVerified ? '✅ vérifié Battle.net' : 'non vérifié Battle.net';
    return `${ROLE_ICONS[c.role]} ${show(c)} · ${ROLE_LABELS[c.role]} · ${sync} · ${bnet}`;
  });
  return ['**Tes persos**', ...lines].join('\n');
}
