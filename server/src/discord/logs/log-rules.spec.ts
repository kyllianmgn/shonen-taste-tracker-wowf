import { eventLevel, eventLogLine, isPublishableEvent, shouldAnnounceLevel, type EventLogContext } from './log-rules';

const AT = new Date('2026-11-07T12:00:00Z');
const HOUR = 3_600_000;

const CTX: EventLogContext = {
  character: { firstName: 'Davina', surname: 'Asaria' },
  female: true,
  hideZone: false,
  levelAnnounceStep: 1,
  logDeaths: true,
};

describe('isPublishableEvent', () => {
  const event = { at: AT, flags: [] as string[], role: 'main' as const };

  it('accepts a fresh, unflagged event of a tracked character', () => {
    expect(isPublishableEvent(event, new Date(AT.getTime() + 23 * HOUR))).toBe(true);
  });

  it('refuses events received more than 24 h after their time', () => {
    expect(isPublishableEvent(event, new Date(AT.getTime() + 24 * HOUR + 1))).toBe(false);
  });

  it('refuses flagged events and untracked characters', () => {
    expect(isPublishableEvent({ ...event, flags: ['suspect_level_jump'] }, AT)).toBe(false);
    expect(isPublishableEvent({ ...event, role: 'untracked' }, AT)).toBe(false);
  });
});

describe('shouldAnnounceLevel', () => {
  it('announces multiples of the step, and 60 always', () => {
    expect(shouldAnnounceLevel(24, 1)).toBe(true);
    expect(shouldAnnounceLevel(24, 5)).toBe(false);
    expect(shouldAnnounceLevel(25, 5)).toBe(true);
    expect(shouldAnnounceLevel(55, 10)).toBe(false);
    expect(shouldAnnounceLevel(60, 7)).toBe(true);
  });

  it('treats a step below 1 as every level', () => {
    expect(shouldAnnounceLevel(13, 0)).toBe(true);
  });
});

describe('eventLevel', () => {
  it('reads an integer level between 1 and 60', () => {
    expect(eventLevel({ level: 24 })).toBe(24);
    expect(eventLevel({ level: '24' })).toBeNull();
    expect(eventLevel({ level: 61 })).toBeNull();
    expect(eventLevel({})).toBeNull();
  });
});

describe('eventLogLine', () => {
  it('renders a level-up with its played time', () => {
    expect(eventLogLine({ type: 'LEVEL_UP', data: { level: 24, playedTotal: 81 * 3600 } }, CTX)).toBe(
      '⬆️ Davina Asaria passe niveau 24 (81 h de jeu)',
    );
  });

  it('skips levels off the announce step but always renders 60 as the trophy line only', () => {
    const ctx = { ...CTX, levelAnnounceStep: 10 };
    expect(eventLogLine({ type: 'LEVEL_UP', data: { level: 24 } }, ctx)).toBeNull();
    expect(eventLogLine({ type: 'LEVEL_UP', data: { level: 30 } }, ctx)).toBe('⬆️ Davina Asaria passe niveau 30');
    expect(eventLogLine({ type: 'LEVEL_UP', data: { level: 60, playedTotal: 220 * 3600 } }, ctx)).toBe(
      '🏆 Davina Asaria atteint le niveau 60 en 9 j 4 h de jeu',
    );
  });

  it('ignores a level-up without a valid level', () => {
    expect(eventLogLine({ type: 'LEVEL_UP', data: {} }, CTX)).toBeNull();
  });

  it('renders deaths only when log_deaths is on', () => {
    const death = { type: 'DEATH', data: { level: 23, zone: 'Duskwood' } };
    expect(eventLogLine(death, CTX)).toBe('💀 Davina Asaria est morte à Duskwood (niv. 23)');
    expect(eventLogLine(death, { ...CTX, logDeaths: false })).toBeNull();
    expect(eventLogLine(death, { ...CTX, hideZone: true })).toBe('💀 Davina Asaria est morte (niv. 23)');
  });

  it('renders guild joins only', () => {
    expect(eventLogLine({ type: 'GUILD_CHANGE', data: { to: 'Les Veilleurs' } }, CTX)).toBe('Davina Asaria rejoint \\<Les Veilleurs>');
    expect(eventLogLine({ type: 'GUILD_CHANGE', data: { from: 'Les Veilleurs', to: 'Autre' } }, CTX)).toBe(
      'Davina Asaria rejoint \\<Autre>',
    );
    expect(eventLogLine({ type: 'GUILD_CHANGE', data: { from: 'Les Veilleurs' } }, CTX)).toBeNull();
    expect(eventLogLine({ type: 'GUILD_CHANGE', data: { to: '' } }, CTX)).toBeNull();
  });

  it('renders dungeon entries, never with hide_zone nor without an instance name', () => {
    const enter = { type: 'DUNGEON_ENTER', data: { instanceName: 'Les Mortemines', instanceId: 36 } };
    expect(eventLogLine(enter, CTX)).toBe('🏰 Davina Asaria entre dans Les Mortemines');
    expect(eventLogLine(enter, { ...CTX, hideZone: true })).toBeNull();
    expect(eventLogLine({ type: 'DUNGEON_ENTER', data: { instanceId: 36 } }, CTX)).toBeNull();
    expect(eventLogLine({ type: 'DUNGEON_ENTER', data: { instanceName: '  ' } }, CTX)).toBeNull();
  });

  it('posts nothing for the other event types', () => {
    for (const type of ['SESSION_START', 'SESSION_END', 'PROFESSION_TIER']) {
      expect(eventLogLine({ type, data: { level: 30 } }, CTX)).toBeNull();
    }
  });
});
