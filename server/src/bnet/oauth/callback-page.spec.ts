import { CALLBACK_PAGES, renderCallbackPage, type CallbackPageKind } from './callback-page';

const KINDS = Object.keys(CALLBACK_PAGES) as CallbackPageKind[];

describe('renderCallbackPage', () => {
  it('says « Liaison réussie, retourne sur Discord » on success, with a 200', () => {
    const page = renderCallbackPage('linked');
    expect(page.status).toBe(200);
    expect(page.html).toContain('Liaison réussie, retourne sur Discord');
  });

  it.each(['state_unknown', 'state_expired', 'state_used'] as const)(
    '%s: error page with a 400 that invites to run /lier battlenet again',
    (kind) => {
      const page = renderCallbackPage(kind);
      expect(page.status).toBe(400);
      expect(page.html).toContain('/lier battlenet');
    },
  );

  it('gives each state problem its own explanation', () => {
    const texts = (['state_unknown', 'state_expired', 'state_used'] as const).map((k) => CALLBACK_PAGES[k].message);
    expect(new Set(texts).size).toBe(3);
  });

  it('shows the docs/02 help text when the account has no Forever character', () => {
    expect(renderCallbackPage('no_characters').html).toContain(
      'Aucun perso Forever trouvé. Connecte-toi une fois en jeu puis déconnecte-toi, et vérifie que le partage des données de jeu avec les développeurs est activé dans la confidentialité Battle.net.',
    );
  });

  it('answers 502 with a generic message when Battle.net failed', () => {
    const page = renderCallbackPage('failed');
    expect(page.status).toBe(502);
    expect(page.html).toContain('/lier battlenet');
  });

  it.each(KINDS)('%s: a complete French HTML page without script or external resource', (kind) => {
    const { html } = renderCallbackPage(kind);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toMatch(/<script|<link|src=/i);
  });

  it('escapes HTML in messages', () => {
    for (const kind of KINDS) expect(renderCallbackPage(kind).html).not.toMatch(/<(?!\/?(?:html|head|meta|title|style|body|main|h1|p)\b|!doctype)/i);
  });
});
