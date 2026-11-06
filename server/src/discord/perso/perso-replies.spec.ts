import type { CharacterName, CharacterRef, OwnedCharacter } from '../../core/characters/character.types';
import { ButtonStyle, ComponentType } from 'discord.js';
import { addReply, listMessage, listReply, PERSO_IDS, setMainReply, untrackReply, PERSO_MSG } from './perso-replies';

const davina: CharacterRef = { id: 1n, region: 'eu', firstName: 'Davina', surname: 'Asaria' };
const borek: CharacterRef = { id: 2n, region: 'eu', firstName: 'Borek', surname: 'Tanu' };
const celia: CharacterName = { region: 'us', firstName: 'Celia', surname: 'Morn' };
const owned = (c: CharacterRef, role: OwnedCharacter['role'], extra: Partial<OwnedCharacter> = {}): OwnedCharacter => ({
  ...c,
  role,
  bnetVerified: false,
  lastSyncAt: null,
  ...extra,
});

describe('addReply', () => {
  it('confirms the role given', () => {
    expect(addReply({ status: 'added', character: davina, role: 'main', created: true })).toBe(
      '✅ **Davina Asaria** (EU) est maintenant ton perso principal.',
    );
    expect(addReply({ status: 'added', character: borek, role: 'alt', created: false })).toBe(
      '✅ **Borek Tanu** (EU) est maintenant ton perso secondaire.',
    );
  });

  it('says the character is already tracked, and points to /perso principal when main was asked', () => {
    expect(addReply({ status: 'already_tracked', character: borek, role: 'alt' })).toBe(
      'ℹ️ **Borek Tanu** (EU) est déjà ton perso secondaire.',
    );
    expect(addReply({ status: 'already_tracked', character: borek, role: 'alt' }, 'main')).toContain('/perso principal');
  });

  it('refuses a character owned by another member without naming them', () => {
    const text = addReply({ status: 'owned_by_other', character: davina });
    expect(text).toBe('❌ **Davina Asaria** (EU) appartient déjà à un autre membre. Si c’est ton perso, contacte un admin du serveur.');
  });

  it('refuses a taken main and suggests adding as secondary then /perso principal', () => {
    const text = addReply({ status: 'role_taken', role: 'main', character: celia, holder: davina });
    expect(text).toBe(
      '❌ Tu as déjà un perso principal : **Davina Asaria** (EU). Ajoute **Celia Morn** (US) en secondaire, puis utilise /perso principal pour échanger.',
    );
  });

  it('refuses a taken secondary and suggests main or /perso retirer', () => {
    const text = addReply({ status: 'role_taken', role: 'alt', character: celia, holder: borek });
    expect(text).toBe(
      '❌ Tu as déjà un perso secondaire : **Borek Tanu** (EU). Ajoute **Celia Morn** (US) en principal, ou retire d’abord ton secondaire avec /perso retirer.',
    );
  });

  it('refuses a 3rd character and lists the two tracked ones', () => {
    const text = addReply({ status: 'too_many', character: celia, tracked: [owned(davina, 'main'), owned(borek, 'alt')] });
    expect(text).toBe(
      '❌ Tu suis déjà 2 persos, le maximum : **Davina Asaria** (EU, principal) et **Borek Tanu** (EU, secondaire). Retires-en un avec /perso retirer avant d’ajouter **Celia Morn** (US).',
    );
  });

  it('explains the name rules', () => {
    expect(addReply({ status: 'invalid_name' })).toBe(PERSO_MSG.invalidName);
    expect(PERSO_MSG.invalidName).toContain('2 à 12 lettres');
  });
});

describe('setMainReply', () => {
  it('announces the swap', () => {
    expect(setMainReply({ status: 'promoted', character: borek, demoted: davina })).toBe(
      '⭐ **Borek Tanu** (EU) est maintenant ton perso principal. **Davina Asaria** (EU) passe en secondaire.',
    );
    expect(setMainReply({ status: 'promoted', character: borek, demoted: null })).toBe(
      '⭐ **Borek Tanu** (EU) est maintenant ton perso principal.',
    );
  });

  it('answers already main, not found and too many', () => {
    expect(setMainReply({ status: 'already_main', character: davina })).toBe(
      'ℹ️ **Davina Asaria** (EU) est déjà ton perso principal.',
    );
    expect(setMainReply({ status: 'not_found' })).toBe(PERSO_MSG.notFound);
    expect(
      setMainReply({
        status: 'too_many',
        character: { id: 3n, ...celia },
        tracked: [owned(davina, 'main'), owned(borek, 'alt')],
      }),
    ).toBe(
      '❌ Tu suis déjà 2 persos, le maximum : **Davina Asaria** (EU, principal) et **Borek Tanu** (EU, secondaire). Retire ton secondaire avec /perso retirer, puis relance /perso principal.',
    );
  });
});

describe('untrackReply', () => {
  it('confirms, or explains', () => {
    expect(untrackReply({ status: 'untracked', character: davina })).toBe(
      '🗑️ **Davina Asaria** (EU) n’est plus suivi. Tu peux le reprendre avec /perso ajouter.',
    );
    expect(untrackReply({ status: 'already_untracked', character: davina })).toBe(
      'ℹ️ **Davina Asaria** (EU) n’est déjà plus suivi.',
    );
    expect(untrackReply({ status: 'not_found' })).toBe(PERSO_MSG.notFound);
  });
});

describe('listReply', () => {
  it('invites to /perso ajouter when empty', () => {
    expect(listReply([])).toBe('Tu ne suis aucun perso. Ajoute-en un avec /perso ajouter.');
  });

  it('shows role, last sync (Discord relative time) and Battle.net check', () => {
    const text = listReply([
      owned(davina, 'main', { bnetVerified: true, lastSyncAt: new Date('2026-11-01T20:00:00Z') }),
      owned(borek, 'alt'),
      owned({ id: 3n, region: 'us', firstName: 'Oldie', surname: 'Tanu' }, 'untracked'),
    ]);
    expect(text).toBe(
      [
        '**Tes persos**',
        '⭐ **Davina Asaria** (EU) · principal · dernière synchro <t:1793563200:R> · ✅ vérifié Battle.net',
        '🔹 **Borek Tanu** (EU) · secondaire · jamais synchronisé · non vérifié Battle.net',
        '▫️ **Oldie Tanu** (US) · non suivi · jamais synchronisé · non vérifié Battle.net',
      ].join('\n'),
    );
  });

  it('escapes Markdown in names coming from other sources', () => {
    expect(listReply([owned({ ...davina, firstName: '*Da_vi*' }, 'main')])).toContain('\\*Da\\_vi\\*');
  });
});

describe('listMessage', () => {
  const mine = [owned(davina, 'main', { bnetVerified: true })];

  it('is the plain list while the Battle.net token is valid or not needed', () => {
    expect(listMessage(mine, false)).toEqual({ content: listReply(mine) });
  });

  it('offers a « Relier Battle.net » button once the base-mode token has expired', () => {
    expect(listMessage(mine, true)).toEqual({
      content: `${listReply(mine)}\n\n${PERSO_MSG.bnetExpired}`,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            { type: ComponentType.Button, style: ButtonStyle.Primary, label: 'Relier Battle.net', custom_id: PERSO_IDS.relinkBnet },
          ],
        },
      ],
    });
    expect(PERSO_MSG.bnetExpired).toContain('expiré');
  });
});
