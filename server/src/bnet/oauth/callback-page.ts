import { NO_FOREVER_CHARACTER_HELP } from './link-outcome';

/**
 * The page the browser lands on after Battle.net (docs/02 « Flux » step 6, « Erreurs »). Pure,
 * static and in French: no script, no external resource, nothing from the request echoed back.
 */

export type CallbackPageKind =
  | 'linked'
  | 'no_characters'
  | 'denied'
  | 'failed'
  | 'state_unknown'
  | 'state_expired'
  | 'state_used';

const RETRY = 'Relance /lier battlenet sur Discord pour obtenir un nouveau lien.';

export const CALLBACK_PAGES: Record<CallbackPageKind, { status: number; title: string; message: string }> = {
  linked: { status: 200, title: 'Liaison réussie', message: 'Liaison réussie, retourne sur Discord.' },
  no_characters: { status: 200, title: 'Aucun perso trouvé', message: NO_FOREVER_CHARACTER_HELP },
  denied: { status: 200, title: 'Liaison annulée', message: `Liaison annulée sur Battle.net. ${RETRY}` },
  failed: {
    status: 502,
    title: 'Liaison impossible',
    message: `Battle.net n’a pas répondu comme prévu, la liaison n’a pas pu se faire. Réessaie dans quelques minutes : ${RETRY}`,
  },
  state_unknown: { status: 400, title: 'Lien invalide', message: `Ce lien de liaison est inconnu. ${RETRY}` },
  state_expired: {
    status: 400,
    title: 'Lien expiré',
    message: `Ce lien de liaison a expiré : il ne vaut que 10 minutes. ${RETRY}`,
  },
  state_used: {
    status: 400,
    title: 'Lien déjà utilisé',
    message: `Ce lien de liaison a déjà été utilisé : il ne sert qu’une seule fois. ${RETRY}`,
  },
};

export function renderCallbackPage(kind: CallbackPageKind): { status: number; html: string } {
  const page = CALLBACK_PAGES[kind];
  const html = [
    '<!doctype html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)} · ForeverTracker</title>`,
    '<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1f2328;background:#fff}@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(page.title)}</h1>`,
    `<p>${escapeHtml(page.message)}</p>`,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
  return { status: page.status, html };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
