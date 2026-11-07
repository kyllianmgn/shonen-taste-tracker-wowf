import type { SessionRecap } from '../../presence/session-recap';
import {
  LOG_MAX_MESSAGE_CHARS,
  renderDeathLog,
  renderGuildJoinLog,
  renderLevel60Log,
  renderBaseModeSessionEndLog,
  renderLevelUpLog,
  renderSessionEndLog,
  renderSessionStartLog,
  renderTrackedLog,
  splitLogMessages,
  type LogPrivacy,
} from './logs';

const USER = '123456789012345678';
const DAVINA = { firstName: 'Davina', surname: 'Asaria' };
const VISIBLE: LogPrivacy = { hideMoney: false, hideZone: false, hidePresence: false };

function recap(overrides: Partial<SessionRecap> = {}): SessionRecap {
  return {
    durationSec: 2 * 3600 + 14 * 60 + 30,
    levelStart: 21,
    levelEnd: 23,
    levelsGained: 2,
    moneyDelta: 380_000,
    playedAddedSec: 2 * 3600 + 14 * 60,
    endZone: 'Bois de la Pénombre',
    endSubZone: 'Darkshire',
    deaths: 1,
    ...overrides,
  };
}

describe('renderSessionStartLog', () => {
  it('matches the reference message', () => {
    expect(renderSessionStartLog({ discordUserId: USER, character: DAVINA, level: 23 })).toBe(
      `🟢 <@${USER}> est en jeu — Davina Asaria (niv. 23)`,
    );
  });

  it('leaves out the level when no snapshot is known', () => {
    expect(renderSessionStartLog({ discordUserId: USER, character: DAVINA, level: null })).toBe(
      `🟢 <@${USER}> est en jeu — Davina Asaria`,
    );
  });

  it('names only the member while the character is unknown', () => {
    expect(renderSessionStartLog({ discordUserId: USER, character: null, level: null })).toBe(`🟢 <@${USER}> est en jeu`);
  });
});

describe('renderBaseModeSessionEndLog', () => {
  it('uses the short form, without duration (docs/02 « Affichage en mode de base »)', () => {
    expect(renderBaseModeSessionEndLog({ discordUserId: USER, character: DAVINA, recap: recap() })).toBe(
      '⚫ Davina Asaria : niv. 21 → 23',
    );
  });

  it('shows a single level when it did not change, and names the member without character', () => {
    expect(
      renderBaseModeSessionEndLog({ discordUserId: USER, character: DAVINA, recap: recap({ levelStart: 23, levelEnd: 23 }) }),
    ).toBe('⚫ Davina Asaria : niv. 23');
    expect(
      renderBaseModeSessionEndLog({ discordUserId: USER, character: null, recap: recap({ levelStart: null, levelEnd: null }) }),
    ).toBe(`⚫ <@${USER}> : session terminée`);
  });
});

describe('renderSessionEndLog', () => {
  it('matches the reference message', () => {
    expect(renderSessionEndLog({ discordUserId: USER, character: DAVINA, recap: recap(), privacy: VISIBLE })).toBe(
      '⚫ Davina Asaria : 2 h 14 de jeu · niv. 21 → 23 · +38 po · fin à Darkshire · 1 mort',
    );
  });

  it('formats short sessions, money lost, the zone without sub-zone and several deaths', () => {
    const line = renderSessionEndLog({
      discordUserId: USER,
      character: DAVINA,
      recap: recap({ durationSec: 45 * 60, levelsGained: 0, levelStart: 23, levelEnd: 23, moneyDelta: -1_250, endSubZone: null, deaths: 3 }),
      privacy: VISIBLE,
    });
    expect(line).toBe('⚫ Davina Asaria : 45 min de jeu · niv. 23 · -12 pa 50 pc · fin à Bois de la Pénombre · 3 morts');
  });

  it('leaves out unknown values, an unchanged purse and zero deaths', () => {
    const line = renderSessionEndLog({
      discordUserId: USER,
      character: DAVINA,
      recap: recap({ levelStart: null, levelEnd: null, levelsGained: null, moneyDelta: 0, endZone: null, endSubZone: null, deaths: 0 }),
      privacy: VISIBLE,
    });
    expect(line).toBe('⚫ Davina Asaria : 2 h 14 de jeu');
  });

  it('hides money, zone and duration according to the player privacy', () => {
    const line = renderSessionEndLog({
      discordUserId: USER,
      character: DAVINA,
      recap: recap(),
      privacy: { hideMoney: true, hideZone: true, hidePresence: true },
    });
    expect(line).toBe('⚫ Davina Asaria : niv. 21 → 23 · 1 mort');
  });

  it('names the member when the character is unknown and says the session ended when nothing is left', () => {
    const line = renderSessionEndLog({
      discordUserId: USER,
      character: null,
      recap: recap({ levelStart: null, levelEnd: null, levelsGained: null, moneyDelta: null, endZone: null, endSubZone: null, deaths: 0 }),
      privacy: { ...VISIBLE, hidePresence: true },
    });
    expect(line).toBe(`⚫ <@${USER}> : session terminée`);
  });
});

describe('renderLevelUpLog', () => {
  it('matches the reference message', () => {
    expect(renderLevelUpLog({ character: DAVINA, level: 24, playedTotal: 81 * 3600 + 1_800 })).toBe(
      '⬆️ Davina Asaria passe niveau 24 (81 h de jeu)',
    );
  });

  it('shows minutes under one hour and nothing without played time', () => {
    expect(renderLevelUpLog({ character: DAVINA, level: 2, playedTotal: 600 })).toBe('⬆️ Davina Asaria passe niveau 2 (10 min de jeu)');
    expect(renderLevelUpLog({ character: DAVINA, level: 24, playedTotal: null })).toBe('⬆️ Davina Asaria passe niveau 24');
  });
});

describe('renderLevel60Log', () => {
  it('matches the reference message', () => {
    expect(renderLevel60Log({ character: DAVINA, playedTotal: (9 * 24 + 4) * 3600 + 120 })).toBe(
      '🏆 Davina Asaria atteint le niveau 60 en 9 j 4 h de jeu',
    );
  });

  it('works without played time', () => {
    expect(renderLevel60Log({ character: DAVINA, playedTotal: null })).toBe('🏆 Davina Asaria atteint le niveau 60');
  });
});

describe('renderTrackedLog', () => {
  it('matches the reference message for both roles', () => {
    expect(renderTrackedLog({ discordUserId: USER, character: DAVINA, role: 'main' })).toBe(
      `➕ <@${USER}> suit Davina Asaria (principal)`,
    );
    expect(renderTrackedLog({ discordUserId: USER, character: DAVINA, role: 'alt' })).toBe(
      `➕ <@${USER}> suit Davina Asaria (secondaire)`,
    );
  });
});

describe('renderDeathLog', () => {
  it('matches the reference message', () => {
    expect(renderDeathLog({ character: DAVINA, female: true, level: 23, zone: 'Duskwood', hideZone: false })).toBe(
      '💀 Davina Asaria est morte à Duskwood (niv. 23)',
    );
  });

  it('uses the masculine form by default and drops what is unknown or hidden', () => {
    expect(renderDeathLog({ character: DAVINA, female: false, level: null, zone: 'Duskwood', hideZone: true })).toBe(
      '💀 Davina Asaria est mort',
    );
  });
});

describe('renderGuildJoinLog', () => {
  it('matches the reference message', () => {
    expect(renderGuildJoinLog({ character: DAVINA, guild: 'Les Veilleurs' })).toBe('Davina Asaria rejoint \\<Les Veilleurs>');
  });

  it('neutralizes markdown and mention syntax coming from the game', () => {
    expect(renderGuildJoinLog({ character: DAVINA, guild: '@everyone *x*' })).toBe('Davina Asaria rejoint \\<@\u200beveryone \\*x\\*>');
    expect(renderGuildJoinLog({ character: DAVINA, guild: '#123' })).toBe('Davina Asaria rejoint \\<#123>');
  });
});

describe('splitLogMessages', () => {
  it('joins the lines of a group in one message', () => {
    expect(splitLogMessages(['a', 'b'])).toEqual(['a\nb']);
  });

  it('starts a new message before the Discord limit', () => {
    const line = 'x'.repeat(900);
    const messages = splitLogMessages([line, line, line]);
    expect(messages).toEqual([`${line}\n${line}`, line]);
    expect(messages.every((m) => m.length <= LOG_MAX_MESSAGE_CHARS)).toBe(true);
  });
});
