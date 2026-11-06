import {
  ButtonStyle,
  ComponentType,
  escapeMarkdown,
  TimestampStyles,
  time,
  type APIActionRowComponent,
  type APIButtonComponentWithURL,
  type APIStringSelectComponent,
} from 'discord.js';
import {
  NO_FOREVER_CHARACTER_HELP,
  type LinkedCharacter,
  type LinkEntryOutcome,
  type LinkOutcome,
  type TransferNotice,
} from '../../bnet/oauth/link-outcome';
import { OAUTH_STATE_TTL_SEC } from '../../bnet/oauth/oauth-state.service';
import { ROLE_LABELS } from '../../core/characters/character-pick';
import type { CharacterName, SetAltResult } from '../../core/characters/character.types';
import { PERSO_MSG } from '../perso/perso-replies';

/** French messages of /lier battlenet (pure functions, docs/03 « Langue du bot »). */

export const BNET_LINK_MSG = {
  denied: '❌ Liaison annulée sur Battle.net. Relance /lier battlenet quand tu veux.',
  failed:
    '❌ La liaison Battle.net a échoué : Battle.net n’a pas répondu comme prévu. Réessaie dans quelques minutes avec /lier battlenet.',
  expiredIntro: 'ℹ️ Ta commande /lier battlenet a expiré sur Discord, voici donc le résultat de la liaison en privé.',
} as const;

/** Custom ids of the two menus of the success message, handled in commands/lier-battlenet.ts. */
export const BNET_SELECT_IDS = { main: 'bnet-link:main', alt: 'bnet-link:alt' } as const;

export interface LinkMessage {
  content: string;
  components: APIActionRowComponent<APIStringSelectComponent>[];
  allowed_mentions: { parse: [] };
}

const MAX_CONTENT = 2000;
const MAX_OPTIONS = 25;
const MAX_LIST_LINES = 25;

const name = (c: CharacterName) => `**${escapeMarkdown(`${c.firstName} ${c.surname}`)}**`;
const show = (c: CharacterName) => `${name(c)} (${c.region.toUpperCase()})`;
const level = (c: LinkedCharacter) => `niv. ${c.level ?? '?'}`;

const OUTCOME_TEXT: Record<Exclude<LinkEntryOutcome, 'owned_by_other'>, string> = {
  verified: 'déjà à toi, maintenant vérifié',
  claimed: 'rattaché et vérifié',
  created: 'ajouté et vérifié',
  transferred: 'repris à un autre membre (admins prévenus)',
};

/** Ephemeral reply of /lier battlenet: explanation and a link button to Battle.net. */
export function renderLierBattlenetReply(url: string, region: string, expiresAt: Date) {
  const minutes = OAUTH_STATE_TTL_SEC / 60;
  const button: APIButtonComponentWithURL = {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: 'Se connecter à Battle.net',
    url,
  };
  return {
    content: [
      `🔗 **Relier ton compte Battle.net** (${region.toUpperCase()})`,
      'Connecte-toi avec le bouton ci-dessous : le bot vérifie que tes persos Forever sont bien à toi et importe leur classe, race, faction et niveau.',
      `Le lien vaut ${minutes} minutes (expire ${time(expiresAt, TimestampStyles.RelativeTime)}) et ne sert qu’une seule fois.`,
      'Ne le partage pas : il relierait ton compte Discord au Battle.net de quelqu’un d’autre.',
    ].join('\n'),
    components: [{ type: ComponentType.ActionRow, components: [button] }],
  };
}

/** Edit of the /lier battlenet reply once the callback is done (docs/02 « Flux » step 6). */
export function renderLinkOutcome(outcome: LinkOutcome): LinkMessage {
  const message = (content: string, components: LinkMessage['components'] = []): LinkMessage => ({
    content,
    components,
    allowed_mentions: { parse: [] },
  });
  switch (outcome.status) {
    case 'no_characters':
      return message(`❌ ${NO_FOREVER_CHARACTER_HELP}`);
    case 'denied':
      return message(BNET_LINK_MSG.denied);
    case 'failed':
      return message(BNET_LINK_MSG.failed);
    case 'linked':
      break;
  }

  const mine = outcome.characters.filter((c) => c.role !== null);
  const lines = outcome.characters.map((c) =>
    c.role === null
      ? `⛔ ${name(c)} · ${level(c)} · appartient à un autre membre vérifié : contacte un admin`
      : `${roleIcon(c)} ${name(c)} · ${level(c)} · ${ROLE_LABELS[c.role]} · ${OUTCOME_TEXT[c.outcome as keyof typeof OUTCOME_TEXT]}`,
  );
  const footer = mine.length > 0 ? ['', 'Choisis ton perso principal et ton secondaire dans les menus ci-dessous.'] : [];
  const content = fit([`✅ **Battle.net relié** (${outcome.region.toUpperCase()})`, 'Persos trouvés sur ton compte :'], lines, footer);

  if (mine.length === 0) return message(content);
  const options = (role: 'main' | 'alt') =>
    mine.slice(0, MAX_OPTIONS).map((c) => ({
      label: `${c.firstName} ${c.surname} (${level(c)})`.slice(0, 100),
      value: c.id.toString(),
      default: c.role === role,
    }));
  const select = (customId: string, placeholder: string, role: 'main' | 'alt'): APIActionRowComponent<APIStringSelectComponent> => ({
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.StringSelect, custom_id: customId, placeholder, min_values: 1, max_values: 1, options: options(role) }],
  });
  return message(content, [
    select(BNET_SELECT_IDS.main, 'Perso principal', 'main'),
    select(BNET_SELECT_IDS.alt, 'Perso secondaire', 'alt'),
  ]);
}

/** Same result sent by DM when the interaction expired (docs/02 « Erreurs »). */
export function renderExpiredDm(outcome: LinkOutcome): LinkMessage {
  const message = renderLinkOutcome(outcome);
  const content = `${BNET_LINK_MSG.expiredIntro}\n\n${message.content}`;
  return { ...message, content: content.length <= MAX_CONTENT ? content : `${content.slice(0, MAX_CONTENT - 1)}…` };
}

/** Line posted in the logs channels for the admins (docs/02 « Flux » step 5). */
export function renderTransferNotice(notice: TransferNotice): string {
  return `⚠️ Battle.net : ${show(notice.character)} appartenait à <@${notice.fromUserId}> sans vérification ; il passe à <@${notice.toUserId}>, qui a prouvé en être le propriétaire avec /lier battlenet.`;
}

/** Reply of the « secondaire » menu. */
export function setAltReply(result: SetAltResult): string {
  switch (result.status) {
    case 'set': {
      const text = `🔹 ${show(result.character)} est maintenant ton perso secondaire.`;
      return result.replaced ? `${text} ${show(result.replaced)} n’est plus suivi.` : text;
    }
    case 'already_alt':
      return `ℹ️ ${show(result.character)} est déjà ton perso secondaire.`;
    case 'is_main':
      return `❌ ${show(result.character)} est ton perso principal. Choisis d’abord un autre principal.`;
    case 'not_found':
      return PERSO_MSG.notFound;
  }
}

function roleIcon(c: LinkedCharacter): string {
  return c.role === 'main' ? '⭐' : c.role === 'alt' ? '🔹' : '▫️';
}

/** Header, as many lines as fit (25 at most, then « … et N autres »), footer: one Discord message. */
function fit(header: string[], lines: string[], footer: string[]): string {
  const join = (shown: string[], hidden: number) =>
    [...header, ...shown, ...(hidden > 0 ? [`… et ${hidden} autres`] : []), ...footer].join('\n');
  let shown = lines.slice(0, MAX_LIST_LINES);
  while (shown.length > 0 && join(shown, lines.length - shown.length).length > MAX_CONTENT) shown = shown.slice(0, -1);
  return join(shown, lines.length - shown.length);
}
