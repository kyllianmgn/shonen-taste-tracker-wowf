import type { AddCharacterResult, OwnedCharacter } from '../../core/characters/character.types';
import { adminAddReply, configReply, SUSPECTS_MAX_CHARS, suspectsReply, type SuspectItem } from './admin-replies';

const MEMBER = '300000000000000002';
const DAVINA = { id: 1n, region: 'eu', firstName: 'Davina', surname: 'Asaria' };
const BOREK: OwnedCharacter = {
  id: 2n,
  region: 'eu',
  firstName: 'Borek',
  surname: 'Tanu',
  role: 'alt',
  bnetVerified: false,
  lastSyncAt: null,
};

describe('configReply', () => {
  const defaults = { levelAnnounceStep: 1, logDeaths: false, boardSort: 'level' as const };

  it('shows the current settings and how to change them', () => {
    const text = configReply(defaults, false);
    expect(text).toContain('**Réglages du serveur**');
    expect(text).toContain('Annonce des niveaux : chaque niveau');
    expect(text).toContain('Morts dans les logs : non');
    expect(text).toContain('Tri du tableau : niveau');
    expect(text).toContain('/config');
  });

  it.each([
    [{ levelAnnounceStep: 5 }, 'Annonce des niveaux : tous les 5 niveaux'],
    [{ levelAnnounceStep: 10 }, 'Annonce des niveaux : tous les 10 niveaux'],
    [{ logDeaths: true }, 'Morts dans les logs : oui'],
    [{ boardSort: 'played' as const }, 'Tri du tableau : temps joué'],
    [{ boardSort: 'name' as const }, 'Tri du tableau : nom'],
  ])('renders %o', (patch, line) => {
    const text = configReply({ ...defaults, ...patch }, true);
    expect(text).toContain('✅ Réglages mis à jour');
    expect(text).toContain(line);
  });
});

describe('adminAddReply', () => {
  it.each<[AddCharacterResult, string]>([
    [{ status: 'added', character: DAVINA, role: 'main', created: true }, `✅ **Davina Asaria** (EU) est maintenant le perso principal de <@${MEMBER}>.`],
    [{ status: 'already_tracked', character: DAVINA, role: 'alt' }, `ℹ️ **Davina Asaria** (EU) est déjà le perso secondaire de <@${MEMBER}>.`],
    [{ status: 'owned_by_other', character: DAVINA }, '❌ **Davina Asaria** (EU) appartient déjà à un autre membre.'],
    [
      { status: 'role_taken', role: 'main', character: DAVINA, holder: { id: 2n, region: 'eu', firstName: 'Borek', surname: 'Tanu' } },
      `❌ <@${MEMBER}> a déjà un perso principal : **Borek Tanu** (EU).`,
    ],
    [{ status: 'too_many', character: DAVINA, tracked: [BOREK, BOREK] }, `❌ <@${MEMBER}> suit déjà 2 persos`],
    [{ status: 'invalid_name' }, '❌ Le prénom et le nom doivent faire chacun 2 à 12 lettres'],
  ])('%o', (result, expected) => {
    expect(adminAddReply(MEMBER, result)).toContain(expected);
  });
});

describe('suspectsReply', () => {
  const at = new Date('2026-11-06T20:00:00Z');
  const ts = Math.floor(at.getTime() / 1000);
  const snapshot: SuspectItem = {
    kind: 'snapshot',
    at,
    character: DAVINA,
    ownerId: MEMBER,
    level: 23,
    flags: ['suspect_level_jump'],
  };
  const event: SuspectItem = {
    kind: 'event',
    at,
    character: DAVINA,
    ownerId: null,
    type: 'LEVEL_UP',
    flags: ['future_timestamp', 'something_new'],
  };

  it('says when nothing was flagged', () => {
    expect(suspectsReply([])).toBe('✅ Aucune donnée signalée ces 7 derniers jours.');
  });

  it('lists flagged snapshots and events with date, character, owner and French flag labels', () => {
    const text = suspectsReply([snapshot, event]);
    expect(text).toContain('**Données signalées (7 derniers jours)**');
    expect(text).toContain(`📸 <t:${ts}:f> · **Davina Asaria** (EU) · <@${MEMBER}> · niveau 23 · saut de niveau suspect`);
    expect(text).toContain(`📜 <t:${ts}:f> · **Davina Asaria** (EU) · sans propriétaire · LEVEL_UP · date dans le futur, something_new`);
  });

  it('stays under the Discord limit and counts what was left out', () => {
    const text = suspectsReply(Array.from({ length: 100 }, () => snapshot));
    expect(text.length).toBeLessThanOrEqual(SUSPECTS_MAX_CHARS);
    expect(text).toMatch(/… et \d+ de plus\.$/);
  });
});
