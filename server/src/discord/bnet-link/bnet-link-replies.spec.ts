import { ButtonStyle, ComponentType } from 'discord.js';
import { NO_FOREVER_CHARACTER_HELP, type LinkedCharacter, type LinkOutcome } from '../../bnet/oauth/link-outcome';
import {
  BNET_LINK_MSG,
  BNET_SELECT_IDS,
  renderExpiredDm,
  renderLierBattlenetReply,
  renderLinkOutcome,
  renderTransferNotice,
  setAltReply,
} from './bnet-link-replies';

const linked = (over: Partial<LinkedCharacter>): LinkedCharacter => ({
  id: 1n,
  region: 'eu',
  firstName: 'Davina',
  surname: 'Asaria',
  level: 23,
  role: 'main',
  outcome: 'verified',
  ...over,
});

const outcome = (characters: LinkedCharacter[]): LinkOutcome => ({ status: 'linked', region: 'eu', characters });

type SelectRow = { type: number; components: Array<{ type: number; custom_id: string; options: Array<{ label: string; value: string; default?: boolean }> }> };
const selects = (rows: unknown[]) => (rows as SelectRow[]).map((r) => r.components[0]);

describe('renderLierBattlenetReply', () => {
  const expiresAt = new Date('2026-11-06T12:10:00Z');
  const reply = renderLierBattlenetReply('https://oauth.battle.net/authorize?state=x', 'eu', expiresAt);

  it('explains the link in French: region, 10 minutes, single use, never shared', () => {
    expect(reply.content).toContain('EU');
    expect(reply.content).toContain('10 minutes');
    expect(reply.content).toContain(`<t:${expiresAt.getTime() / 1000}:R>`);
    expect(reply.content).toMatch(/une seule fois/);
    expect(reply.content).toMatch(/partage/);
  });

  it('carries the authorization URL in a link button', () => {
    expect(reply.components).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: 'Se connecter à Battle.net',
            url: 'https://oauth.battle.net/authorize?state=x',
          },
        ],
      },
    ]);
  });
});

describe('renderLinkOutcome', () => {
  it('lists every character with its level, role and what happened to it', () => {
    const message = renderLinkOutcome(
      outcome([
        linked({ id: 1n, outcome: 'verified', role: 'main' }),
        linked({ id: 2n, firstName: 'Kael', surname: 'Ombre', level: 5, role: 'untracked', outcome: 'created' }),
        linked({ id: 3n, firstName: 'Mira', surname: 'Sol', level: 9, role: 'untracked', outcome: 'transferred' }),
        linked({ id: 4n, firstName: 'Ren', surname: 'Ka', level: 12, role: 'untracked', outcome: 'claimed' }),
        linked({ id: 5n, firstName: 'Zed', surname: 'Vox', level: 40, role: null, outcome: 'owned_by_other' }),
      ]),
    );

    const lines = message.content.split('\n');
    expect(lines[0]).toBe('✅ **Battle.net relié** (EU)');
    expect(message.content).toContain('**Davina Asaria** · niv. 23 · principal · déjà à toi, maintenant vérifié');
    expect(message.content).toContain('**Kael Ombre** · niv. 5 · non suivi · ajouté et vérifié');
    expect(message.content).toContain('**Mira Sol** · niv. 9 · non suivi · repris à un autre membre (admins prévenus)');
    expect(message.content).toContain('**Ren Ka** · niv. 12 · non suivi · rattaché et vérifié');
    expect(message.content).toContain('**Zed Vox** · niv. 40 · appartient à un autre membre vérifié : contacte un admin');
    expect(message.content).toContain('Choisis ton perso principal et ton secondaire');
  });

  it('offers two select menus, main then alt, with the member’s characters only and the current roles preselected', () => {
    const message = renderLinkOutcome(
      outcome([
        linked({ id: 1n, role: 'main' }),
        linked({ id: 2n, firstName: 'Kael', surname: 'Ombre', level: 5, role: 'alt', outcome: 'created' }),
        linked({ id: 5n, firstName: 'Zed', surname: 'Vox', role: null, outcome: 'owned_by_other' }),
      ]),
    );

    const [main, alt] = selects(message.components);
    expect(message.components).toHaveLength(2);
    expect(main).toMatchObject({ type: ComponentType.StringSelect, custom_id: BNET_SELECT_IDS.main });
    expect(alt).toMatchObject({ type: ComponentType.StringSelect, custom_id: BNET_SELECT_IDS.alt });
    expect(main.options).toEqual([
      { label: 'Davina Asaria (niv. 23)', value: '1', default: true },
      { label: 'Kael Ombre (niv. 5)', value: '2', default: false },
    ]);
    expect(alt.options.map((o) => o.default)).toEqual([false, true]);
  });

  it('shows no menu when no character is the member’s', () => {
    const message = renderLinkOutcome(outcome([linked({ role: null, outcome: 'owned_by_other' })]));
    expect(message.components).toEqual([]);
    expect(message.content).not.toContain('Choisis');
  });

  it('writes « niv. ? » when the level is unknown and escapes Markdown in names', () => {
    const message = renderLinkOutcome(outcome([linked({ firstName: 'Da_vi*na', level: null })]));
    expect(message.content).toContain('**Da\\_vi\\*na Asaria** · niv. ?');
  });

  it('stays within Discord limits for a big account: 2 000 characters, 25 options per menu', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      linked({ id: BigInt(i + 1), firstName: `Perso${'x'.repeat(6)}`, surname: `Nom${i}`, role: 'untracked', outcome: 'created' }),
    );
    const message = renderLinkOutcome(outcome(many));
    expect(message.content.length).toBeLessThanOrEqual(2000);
    expect(message.content).toMatch(/… et \d+ autres/);
    for (const select of selects(message.components)) expect(select.options.length).toBeLessThanOrEqual(25);
  });

  it('never pings anyone', () => {
    expect(renderLinkOutcome(outcome([linked({})])).allowed_mentions).toEqual({ parse: [] });
  });

  it.each([
    [{ status: 'no_characters' } as const, `❌ ${NO_FOREVER_CHARACTER_HELP}`],
    [{ status: 'denied' } as const, BNET_LINK_MSG.denied],
    [{ status: 'failed' } as const, BNET_LINK_MSG.failed],
  ])('%p: its own message, without menus', (failure, text) => {
    expect(renderLinkOutcome(failure)).toEqual({ content: text, components: [], allowed_mentions: { parse: [] } });
  });
});

describe('renderExpiredDm', () => {
  it('explains why the result comes in private, then shows it with its menus', () => {
    const plain = renderLinkOutcome(outcome([linked({})]));
    const dm = renderExpiredDm(outcome([linked({})]));
    expect(dm.content.startsWith(BNET_LINK_MSG.expiredIntro)).toBe(true);
    expect(dm.content).toContain(plain.content);
    expect(dm.components).toEqual(plain.components);
    expect(dm.content.length).toBeLessThanOrEqual(2000);
  });
});

describe('renderTransferNotice', () => {
  it('names the character, the former and the new owner for the admins', () => {
    expect(
      renderTransferNotice({
        character: { id: 3n, region: 'eu', firstName: 'Mira', surname: 'Sol' },
        fromUserId: '111',
        toUserId: '222',
      }),
    ).toBe(
      '⚠️ Battle.net : **Mira Sol** (EU) appartenait à <@111> sans vérification ; il passe à <@222>, qui a prouvé en être le propriétaire avec /lier battlenet.',
    );
  });
});

describe('setAltReply', () => {
  const kael = { id: 2n, region: 'eu', firstName: 'Kael', surname: 'Ombre' };
  const mira = { id: 3n, region: 'eu', firstName: 'Mira', surname: 'Sol' };

  it.each([
    [{ status: 'set' as const, character: kael, replaced: null }, '🔹 **Kael Ombre** (EU) est maintenant ton perso secondaire.'],
    [
      { status: 'set' as const, character: kael, replaced: mira },
      '🔹 **Kael Ombre** (EU) est maintenant ton perso secondaire. **Mira Sol** (EU) n’est plus suivi.',
    ],
    [{ status: 'already_alt' as const, character: kael }, 'ℹ️ **Kael Ombre** (EU) est déjà ton perso secondaire.'],
    [
      { status: 'is_main' as const, character: kael },
      '❌ **Kael Ombre** (EU) est ton perso principal. Choisis d’abord un autre principal.',
    ],
  ])('%p', (result, text) => {
    expect(setAltReply(result)).toBe(text);
  });

  it('not_found', () => {
    expect(setAltReply({ status: 'not_found' })).toMatch(/introuvable/);
  });
});
