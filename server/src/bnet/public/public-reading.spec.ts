import { PUBLIC_POLL_ACTIVE_MS, PUBLIC_POLL_QUIET_MS } from './public-poll-interval';
import { planPublicReading, planUnchanged, readPublicCharacter, type PublicPlanInput } from './public-reading';

const NOW = new Date('2026-11-07T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const LOGIN = minutesAgo(30);
const SWORD = [{ slot: 'MAIN_HAND', item: 1 }];
const AXE = [{ slot: 'MAIN_HAND', item: 2 }];

const input = (over: Partial<PublicPlanInput> = {}): PublicPlanInput => ({
  previous: { level: 21, capturedAt: minutesAgo(120) },
  lastPublicEquipment: SWORD,
  poll: { lastModified: 'Sat, 07 Nov 2026 10:00:00 GMT', lastLoginAt: minutesAgo(180), changedAt: minutesAgo(180) },
  reading: { level: 21, equipment: SWORD, lastLoginAt: minutesAgo(180), lastModified: 'Sat, 07 Nov 2026 10:00:00 GMT' },
  now: NOW,
  ...over,
});

describe('readPublicCharacter', () => {
  it('reads the level, the equipment and last_login_timestamp (milliseconds)', () => {
    const reading = readPublicCharacter(
      { level: 23, equipment: SWORD, last_login_timestamp: LOGIN.getTime() },
      'Sat, 07 Nov 2026 11:40:00 GMT',
    );
    expect(reading).toEqual({ level: 23, equipment: SWORD, lastLoginAt: LOGIN, lastModified: 'Sat, 07 Nov 2026 11:40:00 GMT' });
  });

  it('accepts a timestamp in seconds', () => {
    expect(readPublicCharacter({ last_login_timestamp: LOGIN.getTime() / 1_000 }).lastLoginAt).toEqual(LOGIN);
  });

  it('ignores malformed fields', () => {
    expect(readPublicCharacter({ level: 'x' as unknown as number, last_login_timestamp: -3 })).toEqual({
      level: null,
      equipment: null,
      lastLoginAt: null,
      lastModified: null,
    });
    expect(readPublicCharacter({ level: 0 }).level).toBeNull();
    expect(readPublicCharacter({ level: 12.5 }).level).toBeNull();
  });
});

describe('planPublicReading', () => {
  it('records nothing when nothing changed, and keeps the stored state', () => {
    const plan = planPublicReading(input());
    expect(plan.snapshot).toBeNull();
    expect(plan.levelUps).toBeNull();
    expect(plan.sessionEnd).toBeNull();
    expect(plan.poll).toEqual({ ...input().poll, nextPollAt: new Date(NOW.getTime() + PUBLIC_POLL_ACTIVE_MS) });
  });

  it('stores a reference snapshot without events on the first reading', () => {
    const plan = planPublicReading(
      input({ previous: null, lastPublicEquipment: undefined, poll: null, reading: { ...input().reading, lastLoginAt: LOGIN } }),
    );
    expect(plan.snapshot).toEqual({ level: 21, equipment: SWORD, flags: [] });
    expect(plan.levelUps).toBeNull();
    // A first login timestamp is stored but closes no session: the session may be days old.
    expect(plan.sessionEnd).toBeNull();
    expect(plan.poll.lastLoginAt).toEqual(LOGIN);
  });

  it('stores a snapshot and deduces level-ups when the level went up', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, level: 23 } }));
    expect(plan.snapshot).toEqual({ level: 23, equipment: SWORD, flags: [] });
    expect(plan.levelUps).toEqual({ from: 21, to: 23 });
    expect(plan.poll.changedAt).toEqual(NOW);
  });

  it('flags a suspect jump like a sync', () => {
    const plan = planPublicReading(
      input({ previous: { level: 10, capturedAt: minutesAgo(5) }, reading: { ...input().reading, level: 20 } }),
    );
    expect(plan.snapshot?.flags).toEqual(['suspect_level_jump']);
  });

  it('stores a snapshot at the same level when the equipment changed', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, equipment: AXE } }));
    expect(plan.snapshot).toEqual({ level: 21, equipment: AXE, flags: [] });
    expect(plan.levelUps).toBeNull();
    expect(plan.poll.changedAt).toEqual(NOW);
  });

  it('stores the first equipment seen even at the same level', () => {
    const plan = planPublicReading(input({ lastPublicEquipment: undefined }));
    expect(plan.snapshot).toEqual({ level: 21, equipment: SWORD, flags: [] });
  });

  it('ignores a level lower than the stored one (an older public profile)', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, level: 20, equipment: AXE } }));
    expect(plan.snapshot).toBeNull();
    expect(plan.levelUps).toBeNull();
  });

  it('deduces a session end stamped with last_login_timestamp when it moves forward', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, level: 23, lastLoginAt: LOGIN } }));
    expect(plan.sessionEnd).toEqual({ endedAt: LOGIN, levelStart: 21, levelEnd: 23 });
    expect(plan.poll.lastLoginAt).toEqual(LOGIN);
  });

  it('deduces a session end without level change', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, lastLoginAt: LOGIN } }));
    expect(plan.sessionEnd).toEqual({ endedAt: LOGIN, levelStart: 21, levelEnd: 21 });
    expect(plan.snapshot).toBeNull();
  });

  it('never moves last_login backwards and never closes a session twice', () => {
    const later = input({ poll: { ...input().poll!, lastLoginAt: LOGIN }, reading: { ...input().reading, lastLoginAt: minutesAgo(60) } });
    const plan = planPublicReading(later);
    expect(plan.sessionEnd).toBeNull();
    expect(plan.poll.lastLoginAt).toEqual(LOGIN);

    const same = planPublicReading(input({ poll: { ...input().poll!, lastLoginAt: LOGIN }, reading: { ...input().reading, lastLoginAt: LOGIN } }));
    expect(same.sessionEnd).toBeNull();
  });

  it('keeps the stored Last-Modified when the response has none', () => {
    const plan = planPublicReading(input({ reading: { ...input().reading, lastModified: null } }));
    expect(plan.poll.lastModified).toBe('Sat, 07 Nov 2026 10:00:00 GMT');
  });

  it('schedules the next reading from the new state', () => {
    const quiet = input({
      poll: { lastModified: null, lastLoginAt: minutesAgo(3 * 24 * 60), changedAt: minutesAgo(3 * 24 * 60) },
      reading: { level: 21, equipment: SWORD, lastLoginAt: minutesAgo(3 * 24 * 60), lastModified: null },
    });
    expect(planPublicReading(quiet).poll.nextPollAt).toEqual(new Date(NOW.getTime() + PUBLIC_POLL_QUIET_MS));
  });
});

describe('planUnchanged', () => {
  it('only reschedules (304 or 404)', () => {
    const poll = { lastModified: 'x', lastLoginAt: minutesAgo(3 * 24 * 60), changedAt: null };
    expect(planUnchanged(poll, NOW)).toEqual(new Date(NOW.getTime() + PUBLIC_POLL_QUIET_MS));
    expect(planUnchanged(null, NOW)).toEqual(new Date(NOW.getTime() + PUBLIC_POLL_QUIET_MS));
  });
});
