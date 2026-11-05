import {
  BOARD_MAX_COMPONENTS,
  BOARD_MAX_TEXT_CHARS,
  BoardCharacter,
  BoardInput,
  BoardMessagePayload,
  BoardPlayer,
  COMPONENT_TYPE_CONTAINER,
  COMPONENT_TYPE_TEXT_DISPLAY,
  IS_COMPONENTS_V2,
  renderBoard,
} from './board';

const NOW = new Date('2026-11-05T12:00:00Z');
const NOW_TS = Math.floor(NOW.getTime() / 1000);

function char(
  firstName: string,
  surname: string,
  classFile: string | null,
  level: number | null,
  extra: { xp?: number; xpMax?: number; played?: number; zone?: string } = {},
): BoardCharacter {
  return {
    firstName,
    surname,
    classFile,
    snapshot:
      level === null
        ? null
        : {
            level,
            xp: extra.xp ?? null,
            xpMax: extra.xpMax ?? null,
            playedTotal: extra.played ?? null,
            zone: extra.zone ?? null,
          },
  };
}

function player(id: string, overrides: Partial<BoardPlayer> = {}): BoardPlayer {
  return {
    discordUserId: id,
    privacy: { hideZone: false, hidePresence: false },
    presence: { online: false, lastSeenAt: null },
    main: char('Main', id, 'WARRIOR', 10, { xp: 0, xpMax: 1000 }),
    alt: null,
    ...overrides,
  };
}

function input(players: BoardPlayer[], boardSort: BoardInput['guild']['boardSort'] = 'level'): BoardInput {
  return { guild: { boardSort }, players, now: NOW };
}

/** Text of every TextDisplay of every message, joined. */
function allText(messages: BoardMessagePayload[]): string {
  return messages.map(messageText).join('\n');
}

function messageText(message: BoardMessagePayload): string {
  return message.components
    .flatMap((container) => container.components)
    .map((display) => display.content)
    .join('\n');
}

function componentCount(message: BoardMessagePayload): number {
  return message.components.reduce((sum, container) => sum + 1 + container.components.length, 0);
}

const CLASSES = ['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID'];
const FIRST = ['Davina', 'Brom', 'Ilsa', 'Tharn', 'Elowen', 'Garrik', 'Mirelle', 'Odran', 'Sylvi'];
const LAST = ['Asaria', 'Ferrepied', 'Ventbrume', 'Rochecoeur', 'Clairlune', 'Pierrenoire', 'Valombre'];
const ZONES = ['Darkshire', 'Comté de l’Or', 'Les Tarides', 'Bois de la Pénombre', 'Strangleronce'];

/** Deterministic population: mix of online/offline, alts, 60s, unsynced, privacy flags. */
function population(count: number): BoardPlayer[] {
  return Array.from({ length: count }, (_, i) => {
    const level = (i * 7) % 61 || 1;
    const main = char(FIRST[i % FIRST.length], LAST[i % LAST.length], CLASSES[i % CLASSES.length], level, {
      xp: (i * 137) % 1000,
      xpMax: 1000,
      played: 3600 * (i + 1),
      zone: ZONES[i % ZONES.length],
    });
    const alt =
      i % 3 === 0
        ? char(FIRST[(i + 4) % FIRST.length], LAST[(i + 2) % LAST.length], CLASSES[(i + 5) % CLASSES.length], (i % 20) + 1, {
            xp: 500,
            xpMax: 1000,
          })
        : i % 3 === 1
          ? char('Nouveau', `Perso${i}`, null, null)
          : null;
    return player(`1000000000000000${String(i).padStart(2, '0')}`, {
      presence: { online: i % 4 === 0, lastSeenAt: new Date(NOW.getTime() - (i + 1) * 3_600_000) },
      privacy: { hideZone: i % 5 === 0, hidePresence: i % 7 === 3 },
      main,
      alt,
    });
  });
}

describe('renderBoard', () => {
  describe('message envelope', () => {
    it('returns Components V2 payloads: one Container of TextDisplays, flag set, no pings', () => {
      const [message] = renderBoard(input([player('1')]));
      expect(message.flags & IS_COMPONENTS_V2).toBe(IS_COMPONENTS_V2);
      expect(message.allowed_mentions).toEqual({ parse: [] });
      expect(message.components).toHaveLength(1);
      expect(message.components[0].type).toBe(COMPONENT_TYPE_CONTAINER);
      for (const display of message.components[0].components) {
        expect(display.type).toBe(COMPONENT_TYPE_TEXT_DISPLAY);
      }
    });

    it('is pure: same input, same output, input untouched', () => {
      const players = population(12);
      const before = JSON.stringify(players);
      expect(renderBoard(input(players))).toEqual(renderBoard(input(players)));
      expect(JSON.stringify(players)).toBe(before);
    });
  });

  describe('header and footer', () => {
    it('counts tracked players and online players with French plurals', () => {
      expect(allText(renderBoard(input([player('1')])))).toContain('WoW: Forever — 1 joueur suivi · 0 en ligne');
      const two = [player('1', { presence: { online: true, lastSeenAt: null } }), player('2')];
      expect(allText(renderBoard(input(two)))).toContain('WoW: Forever — 2 joueurs suivis · 1 en ligne');
    });

    it('ends the last message with a relative Discord timestamp of now', () => {
      const messages = renderBoard(input([player('1')]));
      expect(messageText(messages[messages.length - 1]).endsWith(`Mis à jour <t:${NOW_TS}:R>`)).toBe(true);
    });

    it('does not count players hiding their presence as online', () => {
      const hidden = player('1', {
        presence: { online: true, lastSeenAt: null },
        privacy: { hideZone: false, hidePresence: true },
      });
      expect(allText(renderBoard(input([hidden])))).toContain('1 joueur suivi · 0 en ligne');
    });
  });

  describe('player lines', () => {
    it('renders the example of the spec', () => {
      const kyllian = player('111', {
        presence: { online: true, lastSeenAt: NOW },
        main: char('Davina', 'Asaria', 'PRIEST', 23, { xp: 380, xpMax: 1000, zone: 'Darkshire' }),
        alt: char('Brom', 'Ferrepied', 'WARRIOR', 11, { xp: 720, xpMax: 1000, zone: 'Elwynn' }),
      });
      const lina = player('222', {
        presence: { online: false, lastSeenAt: new Date(NOW.getTime() - 3 * 3_600_000) },
        main: char('Ilsa', 'Ventbrume', 'MAGE', 19, { xp: 100, xpMax: 1000 }),
        alt: char('Kael', 'Sansnom', 'MAGE', null),
      });
      const text = allText(renderBoard(input([lina, kyllian])));
      const seen = Math.floor((NOW.getTime() - 3 * 3_600_000) / 1000);
      expect(text).toBe(
        [
          'WoW: Forever — 2 joueurs suivis · 1 en ligne',
          '🟢 <@111>\n   Davina Asaria · Prêtre 23 · ▰▰▰▰▱▱▱▱▱▱ 38 % · Darkshire\n   ↳ Brom Ferrepied · Guerrier 11 · ▰▰▱▱▱▱▱▱▱▱ 72 %',
          `⚫ <@222> · vu <t:${seen}:R>\n   Ilsa Ventbrume · Mage 19 · ▰▰▰▱▱▱▱▱▱▱ 10 %\n   ↳ non synchronisé`,
          `Mis à jour <t:${NOW_TS}:R>`,
        ].join('\n'),
      );
    });

    it('shows level 60 without bar nor percentage', () => {
      const p = player('1', { main: char('Davina', 'Asaria', 'PRIEST', 60, { xp: 0, xpMax: 0, zone: 'Orgrimmar' }) });
      expect(allText(renderBoard(input([p])))).toContain('   Davina Asaria · Prêtre 60 · Orgrimmar');
    });

    it('never fills the bar before 60 and floors the XP percentage', () => {
      const p = player('1', { main: char('A', 'B', 'ROGUE', 59, { xp: 999, xpMax: 1000 }) });
      expect(allText(renderBoard(input([p])))).toContain('Voleur 59 · ▰▰▰▰▰▰▰▰▰▱ 99 %');
    });

    it('omits the percentage when XP is unknown and the class when unknown', () => {
      const p = player('1', { main: char('A', 'B', null, 1) });
      expect(allText(renderBoard(input([p])))).toContain('   A B · niv. 1 · ▱▱▱▱▱▱▱▱▱▱\n');
    });

    it('shows « non synchronisé » for a main without snapshot', () => {
      const p = player('1', { main: char('Ilsa', 'Ventbrume', 'MAGE', null) });
      expect(allText(renderBoard(input([p])))).toContain('<@1>\n   Ilsa Ventbrume · non synchronisé');
    });

    it('shows a placeholder for a player without any tracked character', () => {
      const p = player('1', { main: null, alt: null });
      expect(allText(renderBoard(input([p])))).toContain('<@1>\n   aucun perso suivi');
    });

    it('offline player never seen has no « vu »', () => {
      expect(allText(renderBoard(input([player('1')])))).toContain('⚫ <@1>\n');
    });
  });

  describe('privacy', () => {
    const base = {
      presence: { online: true, lastSeenAt: NOW },
      main: char('Davina', 'Asaria', 'PRIEST', 23, { xp: 380, xpMax: 1000, zone: 'Darkshire' }),
    };

    it('hide_zone omits the zone', () => {
      const p = player('1', { ...base, privacy: { hideZone: true, hidePresence: false } });
      const text = allText(renderBoard(input([p])));
      expect(text).not.toContain('Darkshire');
      expect(text).toContain('Prêtre 23 · ▰▰▰▰▱▱▱▱▱▱ 38 %\n');
    });

    it('hide_presence omits the dot and « vu il y a »', () => {
      const offline = player('2', {
        ...base,
        presence: { online: false, lastSeenAt: new Date(NOW.getTime() - 60_000) },
        privacy: { hideZone: false, hidePresence: true },
      });
      const online = player('1', { ...base, privacy: { hideZone: false, hidePresence: true } });
      const text = allText(renderBoard(input([online, offline])));
      expect(text).not.toMatch(/🟢|⚫|vu </);
      expect(text).toContain('\n<@1>\n');
      expect(text).toContain('\n<@2>\n');
      expect(text).toContain('Darkshire');
    });

    it('hide_presence does not leak through online-first ordering', () => {
      const hiddenOnline = player('1', {
        presence: { online: true, lastSeenAt: NOW },
        privacy: { hideZone: false, hidePresence: true },
        main: char('Low', 'Level', 'MAGE', 2),
      });
      const offline = player('2', { main: char('High', 'Level', 'MAGE', 40) });
      const text = allText(renderBoard(input([hiddenOnline, offline])));
      expect(text.indexOf('<@2>')).toBeLessThan(text.indexOf('<@1>'));
    });
  });

  describe('ordering', () => {
    const a = player('a', { main: char('Zed', 'A', 'MAGE', 30, { played: 100 }) });
    const b = player('b', { main: char('Abel', 'B', 'MAGE', 20, { played: 900 }) });
    const c = player('c', {
      presence: { online: true, lastSeenAt: NOW },
      main: char('Mia', 'C', 'MAGE', 5, { played: 50 }),
    });
    const d = player('d', { main: char('Unsynced', 'D', 'MAGE', null) });
    const order = (sort: BoardInput['guild']['boardSort']) => {
      const text = allText(renderBoard(input([d, a, b, c], sort)));
      return ['a', 'b', 'c', 'd'].sort((x, y) => text.indexOf(`<@${x}>`) - text.indexOf(`<@${y}>`));
    };

    it('online first, then main level descending', () => expect(order('level')).toEqual(['c', 'a', 'b', 'd']));
    it('online first, then played time descending', () => expect(order('played')).toEqual(['c', 'b', 'a', 'd']));
    it('online first, then main name', () => expect(order('name')).toEqual(['c', 'b', 'd', 'a']));
  });

  describe('splitting', () => {
    it.each([0, 1, 12, 45, 120])('%i players: every message within limits', (count) => {
      const messages = renderBoard(input(population(count)));
      for (const message of messages) {
        expect(messageText(message).length).toBeLessThanOrEqual(BOARD_MAX_TEXT_CHARS);
        expect(componentCount(message)).toBeLessThanOrEqual(BOARD_MAX_COMPONENTS);
      }
    });

    it('never splits a player across messages and keeps every player once, in order', () => {
      const players = population(120);
      const messages = renderBoard(input(players));
      expect(messages.length).toBeGreaterThan(1);
      const blocks = messages.flatMap((m) => m.components[0].components.map((d) => d.content));
      const playerBlocks = blocks.filter((b) => /^(🟢 |⚫ )?<@\d+>/.test(b));
      expect(playerBlocks).toHaveLength(players.length);
      for (const block of playerBlocks) {
        expect(block.match(/<@\d+>/g)).toHaveLength(1);
      }
      expect(messageText(messages[0]).startsWith('WoW: Forever — 120 joueurs suivis')).toBe(true);
      expect(messageText(messages[messages.length - 1])).toContain('Mis à jour');
      expect(messages.slice(0, -1).some((m) => messageText(m).includes('Mis à jour'))).toBe(false);
    });

    it('splits on the component budget even when text is short', () => {
      const players = Array.from({ length: 80 }, (_, i) => player(String(i), { main: null }));
      const messages = renderBoard(input(players));
      expect(messages.length).toBeGreaterThan(2);
      for (const message of messages) expect(componentCount(message)).toBeLessThanOrEqual(BOARD_MAX_COMPONENTS);
    });
  });

  describe('reference renders', () => {
    it.each([0, 1, 12, 45])('%i players', (count) => {
      expect(renderBoard(input(population(count)))).toMatchSnapshot();
    });
  });
});
