import { buildRecap, isQuietSession, startValues, type RecapInput } from './session-recap';

const T = new Date('2026-11-06T20:00:00Z');
const at = (sec: number) => new Date(T.getTime() + sec * 1_000);

const input = (over: Partial<RecapInput> = {}): RecapInput => ({
  startedAt: T,
  endedAt: at(2 * 3600 + 14 * 60),
  levelStart: 21,
  levelEnd: 23,
  moneyStart: 100_000n,
  moneyEnd: 480_000n,
  playedStart: 70_000,
  playedEnd: 78_000,
  endZone: 'Duskwood',
  endSubZone: 'Darkshire',
  deaths: 1,
  ...over,
});

describe('buildRecap', () => {
  it('computes duration, levels, money, played time, end zone and deaths', () => {
    expect(buildRecap(input())).toEqual({
      durationSec: 8040,
      levelStart: 21,
      levelEnd: 23,
      levelsGained: 2,
      moneyDelta: 380_000,
      playedAddedSec: 8000,
      endZone: 'Duskwood',
      endSubZone: 'Darkshire',
      deaths: 1,
    });
  });

  it('reports money lost as a negative delta', () => {
    expect(buildRecap(input({ moneyStart: 500n, moneyEnd: 200n })).moneyDelta).toBe(-300);
  });

  it('leaves a delta null when one of its ends is unknown (no sync during the session)', () => {
    const recap = buildRecap(input({ levelEnd: null, moneyStart: null, playedEnd: null, endZone: null, endSubZone: null }));
    expect(recap).toMatchObject({ levelsGained: null, moneyDelta: null, playedAddedSec: null, endZone: null, endSubZone: null });
  });

  it('never reports a negative duration', () => {
    expect(buildRecap(input({ endedAt: at(-5) })).durationSec).toBe(0);
  });
});

describe('isQuietSession — under 2 min without any change: closed without log', () => {
  const short = { endedAt: at(119), levelEnd: 21, moneyEnd: 100_000n, deaths: 0 };

  it('is quiet when shorter than 2 min with nothing gained, lost or died', () => {
    expect(isQuietSession(buildRecap(input(short)))).toBe(true);
  });

  it('is quiet for a bare launch/close with no character data at all', () => {
    const bare = { endedAt: at(30), levelStart: null, levelEnd: null, moneyStart: null, moneyEnd: null, deaths: 0 };
    expect(isQuietSession(buildRecap(input(bare)))).toBe(true);
  });

  it('is not quiet from 2 min on', () => {
    expect(isQuietSession(buildRecap(input({ ...short, endedAt: at(120) })))).toBe(false);
  });

  it.each([
    ['a level gained', { levelEnd: 22 }],
    ['money changed', { moneyEnd: 99_000n }],
    ['a death', { deaths: 1 }],
  ])('is not quiet when short but with %s', (_label, change) => {
    expect(isQuietSession(buildRecap(input({ ...short, ...change })))).toBe(false);
  });
});

describe('startValues', () => {
  const baseline = { level: 21, money: 1_000n, playedTotal: 70_000 };
  const first = { level: 23, money: 5_000n, playedTotal: 78_000 };

  it('starts from the last snapshot stored before the session', () => {
    expect(startValues({ baseline, first })).toEqual({ levelStart: 21, moneyStart: 1_000n, playedStart: 70_000 });
  });

  it('falls back to the first snapshot of the session for a character never synced before', () => {
    expect(startValues({ baseline: null, first })).toEqual({ levelStart: 23, moneyStart: 5_000n, playedStart: 78_000 });
  });

  it('is empty without any snapshot', () => {
    expect(startValues({ baseline: null, first: null })).toEqual({
      levelStart: null,
      moneyStart: null,
      playedStart: null,
    });
  });
});
