import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIButtonComponentWithCustomId } from 'discord.js';
import type { Privacy } from '../../core/players/player-account.service';

/** French replies of /confidentialite and /quitter (pure functions, docs/03 « Langue du bot »). */

/** Custom ids of the /quitter buttons, handled in commands/quitter.ts. */
export const QUIT_IDS = { confirm: 'quitter:confirm', cancel: 'quitter:cancel' } as const;

/** The /quitter confirmation button works this long after the prompt. */
export const QUIT_CONFIRM_TTL_MS = 60_000;

export const QUIT_MSG = {
  done: '🗑️ Tes données sont supprimées et tes appareils déconnectés. Tes persos ne sont plus suivis. Tu peux revenir quand tu veux avec /perso ajouter ou /lier.',
  nothing: 'ℹ️ Le bot n’a aucune donnée à ton nom.',
  expired: '⌛ Confirmation expirée : rien n’a été supprimé. Relance /quitter si tu veux toujours supprimer tes données.',
  cancelled: '👍 Rien n’a été supprimé.',
} as const;

const line = (label: string, hidden: boolean) => (hidden ? `🙈 ${label} : masqué` : `👁️ ${label} : visible`);

export function privacyReply(privacy: Privacy, changed: boolean): string {
  const lines = [
    changed ? '✅ Confidentialité mise à jour.' : '**Ta confidentialité**',
    line('Or', privacy.hideMoney),
    line('Zone', privacy.hideZone),
    line('Statut en ligne', privacy.hidePresence),
    'Une info masquée n’apparaît ni dans le tableau, ni dans /profil, /session et /classement, ni dans les logs.',
  ];
  if (!changed) lines.push('Change-les avec /confidentialite or:… zone:… presence:…');
  return lines.join('\n');
}

export interface QuitPrompt {
  content: string;
  components: APIActionRowComponent<APIButtonComponentWithCustomId>[];
}

export function quitPrompt(now: Date): QuitPrompt {
  const deadline = Math.floor((now.getTime() + QUIT_CONFIRM_TTL_MS) / 1000);
  return {
    content: [
      '⚠️ **Supprimer toutes tes données ?**',
      'Tes persos ne seront plus suivis sur aucun serveur, tes appareils (appli compagnon) seront déconnectés et ton historique sera effacé. C’est définitif.',
      `Le bouton expire <t:${deadline}:R>.`,
    ].join('\n'),
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Oui, tout supprimer', custom_id: QUIT_IDS.confirm },
          { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Annuler', custom_id: QUIT_IDS.cancel },
        ],
      },
    ],
  };
}
