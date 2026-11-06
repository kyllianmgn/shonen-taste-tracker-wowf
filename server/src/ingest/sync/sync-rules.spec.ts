import {
  FUTURE_TOLERANCE_SEC,
  SUSPECT_JUMP_LEVELS,
  SUSPECT_JUMP_WINDOW_SEC,
  assignRole,
  checkPayloadCharacter,
  judgeSnapshot,
} from './sync-rules';

const T0 = 1_793_900_000;
const nowMs = (sec: number) => sec * 1_000;

describe('checkPayloadCharacter', () => {
  const character = (capturedAt: number, eventAts: number[] = [], level = 23) => ({
    snapshot: { capturedAt, level },
    events: eventAts.map((at) => ({ at })),
  });

  it('accepts timestamps up to 5 minutes in the future', () => {
    expect(FUTURE_TOLERANCE_SEC).toBe(300);
    expect(checkPayloadCharacter(character(T0 + 300, [T0 + 300]), nowMs(T0), 60)).toEqual([]);
  });

  it('rejects a capturedAt more than 5 minutes in the future', () => {
    expect(checkPayloadCharacter(character(T0 + 301), nowMs(T0), 60)).toEqual(['future_timestamp']);
  });

  it('rejects an event more than 5 minutes in the future', () => {
    expect(checkPayloadCharacter(character(T0, [T0 - 10, T0 + 301]), nowMs(T0), 60)).toEqual(['future_timestamp']);
  });

  it('compares with milliseconds precision of the clock', () => {
    expect(checkPayloadCharacter(character(T0 + 301), nowMs(T0) + 999, 60)).toEqual(['future_timestamp']);
    expect(checkPayloadCharacter(character(T0 + 301), nowMs(T0) + 1_000, 60)).toEqual([]);
  });

  it('rejects a level above LEVEL_CAP', () => {
    expect(checkPayloadCharacter(character(T0, [], 41), nowMs(T0), 40)).toEqual(['level_above_cap']);
    expect(checkPayloadCharacter(character(T0, [], 40), nowMs(T0), 40)).toEqual([]);
  });

  it('reports both problems at once', () => {
    expect(checkPayloadCharacter(character(T0 + 400, [], 41), nowMs(T0), 40)).toEqual([
      'future_timestamp',
      'level_above_cap',
    ]);
  });
});

describe('judgeSnapshot', () => {
  const prev = { capturedAt: T0, level: 23, playedTotal: 81_234 };

  it('stores the first snapshot of a character without flags', () => {
    expect(judgeSnapshot(null, { capturedAt: T0, level: 60 })).toEqual({ action: 'store', flags: [] });
  });

  it('stores a normal progression without flags', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 24, playedTotal: 81_834 })).toEqual({
      action: 'store',
      flags: [],
    });
  });

  it('ignores an older snapshot, even one that would be a regression', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0 - 1, level: 2, playedTotal: 1 })).toEqual({ action: 'ignore' });
  });

  it('ignores a snapshot with the same capturedAt (replayed sync)', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0, level: 23, playedTotal: 81_234 })).toEqual({ action: 'ignore' });
  });

  it('rejects a lower level as a regression', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 22, playedTotal: 81_834 })).toEqual({
      action: 'reject',
      flags: ['regression'],
    });
  });

  it('rejects a lower playedTotal as a regression', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 23, playedTotal: 81_000 })).toEqual({
      action: 'reject',
      flags: ['regression'],
    });
  });

  it('does not compare playedTotal when one side lacks it', () => {
    expect(judgeSnapshot({ ...prev, playedTotal: null }, { capturedAt: T0 + 600, level: 23, playedTotal: 1 })).toEqual(
      { action: 'store', flags: [] },
    );
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 23 })).toEqual({ action: 'store', flags: [] });
  });

  it('flags more than 5 levels gained in less than 15 minutes', () => {
    expect(SUSPECT_JUMP_LEVELS).toBe(5);
    expect(SUSPECT_JUMP_WINDOW_SEC).toBe(900);
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 31 })).toEqual({
      action: 'store',
      flags: ['suspect_level_jump'],
    });
    expect(judgeSnapshot(prev, { capturedAt: T0 + 899, level: 29 })).toEqual({
      action: 'store',
      flags: ['suspect_level_jump'],
    });
  });

  it('does not flag exactly 5 levels, nor a jump spread over 15 minutes or more', () => {
    expect(judgeSnapshot(prev, { capturedAt: T0 + 600, level: 28 })).toEqual({ action: 'store', flags: [] });
    expect(judgeSnapshot(prev, { capturedAt: T0 + 900, level: 31 })).toEqual({ action: 'store', flags: [] });
  });
});

describe('assignRole', () => {
  it('makes the first tracked character the main', () => {
    expect(assignRole([])).toBe('main');
  });

  it('makes the second one the alt', () => {
    expect(assignRole(['main'])).toBe('alt');
  });

  it('gives main back when only an alt is tracked', () => {
    expect(assignRole(['alt'])).toBe('main');
  });

  it('stores a third character as untracked', () => {
    expect(assignRole(['main', 'alt'])).toBe('untracked');
  });
});
