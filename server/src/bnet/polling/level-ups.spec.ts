import { bnetLevelUpEventId, deduceLevelUps } from './level-ups';

const AT = new Date('2026-11-06T12:00:00Z');

describe('deduceLevelUps', () => {
  it('creates one LEVEL_UP per level gained, with the bnet-<character_id>-<level> id', () => {
    expect(deduceLevelUps(42n, 21, 23, AT)).toEqual([
      { eventId: 'bnet-42-22', type: 'LEVEL_UP', at: AT, data: { level: 22 } },
      { eventId: 'bnet-42-23', type: 'LEVEL_UP', at: AT, data: { level: 23 } },
    ]);
  });

  it('creates nothing when the level did not go up', () => {
    expect(deduceLevelUps(42n, 23, 23, AT)).toEqual([]);
    expect(deduceLevelUps(42n, 23, 22, AT)).toEqual([]);
  });

  it('builds a stable id', () => {
    expect(bnetLevelUpEventId(7n, 60)).toBe('bnet-7-60');
  });
});
