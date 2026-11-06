import {
  formatDuration,
  formatMoney,
  formatSignedMoney,
  LEADERBOARD_SIZE,
  MAX_REPLY_CHARS,
  renderLeaderboard,
  renderProfile,
  renderSession,
  type LeaderboardEntry,
  type Privacy,
  type ProfileInput,
  type SessionInput,
} from './profile';

const USER = '300000000000000001';
const VISIBLE: Privacy = { hideMoney: false, hideZone: false, hidePresence: false };
const at = (unix: number) => new Date(unix * 1000);

function davina(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    discordUserId: USER,
    privacy: VISIBLE,
    character: { firstName: 'Davina', surname: 'Asaria', classFile: 'PRIEST', role: 'main' },
    snapshot: {
      level: 23,
      xp: 4120,
      xpMax: 13600,
      money: 384512n,
      playedTotal: 81234,
      zone: 'Duskwood',
      subZone: 'Darkshire',
      receivedAt: at(1793900000),
      detail: {
        guild: 'Les Veilleurs',
        guildRank: 'Membre',
        ilvl: 21.4,
        professions: [
          { name: 'Herboristerie', rank: 112, max: 150 },
          { name: 'Alchimie', rank: 90, max: 150 },
        ],
        reputations: [
          { name: 'Orgrimmar', standing: 6 },
          { name: 'Sombrelune', standing: 5 },
          { name: 'Les Pitons-du-Tonnerre', standing: 8 },
          { name: 'Fossoyeuses', standing: 7 },
        ],
      },
    },
    levels: [
      { level: 23, at: at(1793899800) },
      { level: 22, at: at(1793800000) },
    ],
    ...overrides,
  };
}

describe('formatting', () => {
  it.each([
    [0n, '0 pc'],
    [7n, '7 pc'],
    [384512n, '38 po 45 pa 12 pc'],
    [380000n, '38 po'],
    [1205n, '12 pa 5 pc'],
  ])('formatMoney(%p) = %p', (copper, text) => {
    expect(formatMoney(copper)).toBe(text);
  });

  it.each([
    [380000n, '+38 po'],
    [-1200n, '-12 pa'],
    [0n, '0 pc'],
  ])('formatSignedMoney(%p) = %p', (copper, text) => {
    expect(formatSignedMoney(copper)).toBe(text);
  });

  it.each([
    [0, '0 min'],
    [59 * 60 + 59, '59 min'],
    [3600, '1 h'],
    [2 * 3600 + 5 * 60, '2 h 05'],
    [81234, '22 h 33'],
    [9 * 86400 + 4 * 3600 + 59 * 60, '9 j 4 h'],
    [2 * 86400, '2 j'],
  ])('formatDuration(%p) = %p', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('renderProfile', () => {
  it('renders the reference profile', () => {
    expect(renderProfile(davina())).toBe(
      [
        `**Davina Asaria** · Prêtre · principal de <@${USER}>`,
        'Niveau 23 · ▰▰▰▱▱▱▱▱▱▱ 30 % (4120 / 13600 XP)',
        '⏱️ Temps joué : 22 h 33',
        '💰 Or : 38 po 45 pa 12 pc',
        '📍 Zone : Darkshire, Duskwood',
        '🛡️ Guilde : <Les Veilleurs> · Membre',
        '⚔️ Équipement : ilvl 21',
        '🛠️ Métiers : Herboristerie 112/150 · Alchimie 90/150',
        '🤝 Réputations : Les Pitons-du-Tonnerre (Exalté) · Fossoyeuses (Révéré) · Orgrimmar (Honoré)',
        '📈 Derniers niveaux :',
        '• niv. 23 — <t:1793899800:d>',
        '• niv. 22 — <t:1793800000:d>',
        'Synchro <t:1793900000:R>',
      ].join('\n'),
    );
  });

  it('renders a level 60 secondary character without a bar and without the empty sections', () => {
    const base = davina();
    const text = renderProfile({
      ...base,
      character: { ...base.character, role: 'alt', classFile: null },
      snapshot: {
        ...base.snapshot!,
        level: 60,
        xp: 0,
        xpMax: 0,
        zone: 'Tanaris',
        subZone: null,
        detail: { professions: [], reputations: [{ name: 'Orgrimmar', standing: 5 }] },
      },
      levels: [],
    });

    expect(text).toBe(
      [
        `**Davina Asaria** · secondaire de <@${USER}>`,
        'Niveau 60',
        '⏱️ Temps joué : 22 h 33',
        '💰 Or : 38 po 45 pa 12 pc',
        '📍 Zone : Tanaris',
        'Synchro <t:1793900000:R>',
      ].join('\n'),
    );
  });

  it('says when the character was never synchronized', () => {
    expect(renderProfile(davina({ snapshot: null, levels: [] }))).toBe(
      [
        `**Davina Asaria** · Prêtre · principal de <@${USER}>`,
        'Pas encore synchronisé : lance le jeu avec l’appli compagnon ou utilise /sync.',
      ].join('\n'),
    );
  });

  it('hides the gold with hide_money', () => {
    const text = renderProfile(davina({ privacy: { ...VISIBLE, hideMoney: true } }));
    expect(text).not.toContain('💰');
    expect(text).not.toContain(' po');
  });

  it('hides the zone with hide_zone', () => {
    const text = renderProfile(davina({ privacy: { ...VISIBLE, hideZone: true } }));
    expect(text).not.toContain('Zone');
    expect(text).not.toContain('Darkshire');
    expect(text).not.toContain('Duskwood');
  });

  it('hides the last sync time with hide_presence', () => {
    const text = renderProfile(davina({ privacy: { ...VISIBLE, hidePresence: true } }));
    expect(text).not.toContain('Synchro');
    expect(text).not.toContain(':R>');
  });

  it('stays under the Discord message limit with many professions and reputations', () => {
    const base = davina();
    const reputations = Array.from({ length: 200 }, (_, i) => ({ name: `Faction numéro ${i}`, standing: 8 }));
    const text = renderProfile({ ...base, snapshot: { ...base.snapshot!, detail: { ...base.snapshot!.detail, reputations } } });

    expect(text.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(text).toContain('Faction numéro 0 (Exalté)');
    expect(text).toMatch(/\+ \d+ autres/);
  });
});

describe('renderSession', () => {
  const ended: SessionInput = {
    discordUserId: USER,
    privacy: VISIBLE,
    character: { firstName: 'Davina', surname: 'Asaria' },
    startedAt: at(1793890000),
    endedAt: at(1793890000 + 2 * 3600 + 14 * 60),
    levelStart: 21,
    levelEnd: 23,
    moneyStart: 100000n,
    moneyEnd: 480000n,
    playedStart: 70000,
    playedEnd: 70000 + 2 * 3600 + 10 * 60,
    zone: 'Duskwood',
    subZone: 'Darkshire',
    deaths: 1,
  };

  it('renders the reference recap of an ended session', () => {
    expect(renderSession(ended, at(1793900000))).toBe(
      [
        `⚫ **Dernière session** de <@${USER}> — Davina Asaria`,
        `⏱️ Durée : 2 h 14 · terminée <t:${1793890000 + 2 * 3600 + 14 * 60}:R>`,
        '⬆️ Niveaux : 21 → 23 (+2)',
        '💰 Or : +38 po',
        '🎮 Temps de jeu ajouté : 2 h 10',
        '📍 Fin à Darkshire, Duskwood',
        '💀 Morts : 1',
      ].join('\n'),
    );
  });

  it('renders a session in progress up to now', () => {
    const text = renderSession(
      { ...ended, endedAt: null, levelEnd: 21, moneyEnd: 100000n, playedEnd: null, subZone: null, deaths: 0 },
      at(1793890000 + 3900),
    );
    expect(text).toBe(
      [
        `🟢 **Session en cours** de <@${USER}> — Davina Asaria`,
        '⏱️ Depuis <t:1793890000:R> (1 h 05)',
        '⬆️ Niveau : 21',
        '💰 Or : 0 pc',
        '📍 Zone actuelle : Duskwood',
        '💀 Morts : 0',
      ].join('\n'),
    );
  });

  it('renders a session whose character is not known yet', () => {
    const text = renderSession(
      {
        ...ended,
        character: null,
        levelStart: null,
        levelEnd: null,
        moneyStart: null,
        moneyEnd: null,
        playedStart: null,
        playedEnd: null,
        zone: null,
        subZone: null,
        deaths: 0,
      },
      at(1793900000),
    );
    expect(text).toBe(
      [
        `⚫ **Dernière session** de <@${USER}> — perso inconnu`,
        `⏱️ Durée : 2 h 14 · terminée <t:${1793890000 + 2 * 3600 + 14 * 60}:R>`,
        '💀 Morts : 0',
      ].join('\n'),
    );
  });

  it('hides the gold with hide_money', () => {
    const text = renderSession({ ...ended, privacy: { ...VISIBLE, hideMoney: true } }, at(1793900000));
    expect(text).not.toContain('💰');
    expect(text).not.toContain('po');
  });

  it('hides the zone with hide_zone', () => {
    const text = renderSession({ ...ended, privacy: { ...VISIBLE, hideZone: true } }, at(1793900000));
    expect(text).not.toContain('Darkshire');
    expect(text).not.toContain('Duskwood');
  });

  it('hides when the session ended with hide_presence', () => {
    const text = renderSession({ ...ended, privacy: { ...VISIBLE, hidePresence: true } }, at(1793900000));
    expect(text).toContain('⏱️ Durée : 2 h 14\n');
    expect(text).not.toContain('<t:');
  });
});

describe('renderLeaderboard', () => {
  let n = 0;
  function entry(
    firstName: string,
    snapshot: Partial<NonNullable<LeaderboardEntry['snapshot']>> | null,
    privacy: Partial<Privacy> = {},
  ): LeaderboardEntry {
    n += 1;
    return {
      discordUserId: `30000000000000${String(n).padStart(4, '0')}`,
      privacy: { ...VISIBLE, ...privacy },
      character: { firstName, surname: 'Test' },
      snapshot:
        snapshot && { level: 10, xp: null, xpMax: null, playedTotal: null, money: null, deaths: null, ...snapshot },
    };
  }

  beforeEach(() => {
    n = 0;
  });

  it('renders the reference top by level, XP breaking ties', () => {
    const entries = [
      entry('Brom', { level: 11, xp: 100, xpMax: 1000 }),
      entry('Davina', { level: 23 }),
      entry('Ilsa', { level: 11, xp: 900, xpMax: 1000 }),
      entry('Zed', { level: 5 }),
      entry('Nosnap', null),
    ];
    expect(renderLeaderboard({ criterion: 'level', entries })).toBe(
      [
        '🏆 **Classement — niveau**',
        '🥇 Davina Test · <@300000000000000002> — niv. 23',
        '🥈 Ilsa Test · <@300000000000000003> — niv. 11',
        '🥉 Brom Test · <@300000000000000001> — niv. 11',
        '4. Zed Test · <@300000000000000004> — niv. 5',
      ].join('\n'),
    );
  });

  it('keeps the top 15 only', () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`P${i}`, { level: i + 1 }));
    const lines = renderLeaderboard({ criterion: 'level', entries }).split('\n');
    expect(lines).toHaveLength(1 + LEADERBOARD_SIZE);
    expect(lines[1]).toContain('niv. 20');
    expect(lines[15]).toBe('15. P5 Test · <@300000000000000006> — niv. 6');
  });

  it('ranks by played time, skipping unknown values', () => {
    const entries = [entry('A', { playedTotal: 3600 }), entry('B', { playedTotal: 81234 }), entry('C', {})];
    expect(renderLeaderboard({ criterion: 'played', entries })).toBe(
      [
        '🏆 **Classement — temps joué**',
        '🥇 B Test · <@300000000000000002> — 22 h 33',
        '🥈 A Test · <@300000000000000001> — 1 h',
      ].join('\n'),
    );
  });

  it('ranks by pace (levels per played hour) among characters with at least 1 h played', () => {
    const entries = [
      entry('Slow', { level: 11, playedTotal: 20 * 3600 }), // 0.5 / h
      entry('Fast', { level: 13, playedTotal: 8 * 3600 }), // 1.5 / h
      entry('Fresh', { level: 3, playedTotal: 3599 }), // under 1 h: not ranked
    ];
    expect(renderLeaderboard({ criterion: 'pace', entries })).toBe(
      [
        '🏆 **Classement — rythme**',
        '🥇 Fast Test · <@300000000000000002> — 1,50 niv./h',
        '🥈 Slow Test · <@300000000000000001> — 0,50 niv./h',
      ].join('\n'),
    );
  });

  it('ranks by gold and leaves out the players who hide it', () => {
    const entries = [
      entry('Poor', { money: 1205n }),
      entry('Rich', { money: 384512n }),
      entry('Secret', { money: 99999999n }, { hideMoney: true }),
    ];
    const text = renderLeaderboard({ criterion: 'money', entries });
    expect(text).toBe(
      [
        '🏆 **Classement — or**',
        '🥇 Rich Test · <@300000000000000002> — 38 po 45 pa 12 pc',
        '🥈 Poor Test · <@300000000000000001> — 12 pa 5 pc',
      ].join('\n'),
    );
    expect(text).not.toContain('Secret');
  });

  it('keeps the players who hide their gold in the other rankings', () => {
    const entries = [entry('Secret', { level: 30, money: 99999999n }, { hideMoney: true })];
    const text = renderLeaderboard({ criterion: 'level', entries });
    expect(text).toContain('Secret Test');
    expect(text).not.toContain('po');
  });

  it('ranks by deaths', () => {
    const entries = [entry('Careful', { deaths: 0 }), entry('Reckless', { deaths: 12 }), entry('Unknown', {})];
    expect(renderLeaderboard({ criterion: 'deaths', entries })).toBe(
      [
        '🏆 **Classement — morts**',
        '🥇 Reckless Test · <@300000000000000002> — 12 morts',
        '🥈 Careful Test · <@300000000000000001> — 0 mort',
      ].join('\n'),
    );
  });

  it('says when nobody can be ranked', () => {
    expect(renderLeaderboard({ criterion: 'money', entries: [entry('A', null)] })).toBe(
      ['🏆 **Classement — or**', 'Personne n’est encore classé sur ce critère.'].join('\n'),
    );
  });
});
