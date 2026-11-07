import { EventEmitter2 } from '@nestjs/event-emitter';
import nock from 'nock';
import type { SessionEndedEvent } from '../../presence/presence.events';
import type { CharacterUpdatedEvent, EventRecordedEvent } from '../../ingest/sync/sync.events';
import { BnetPublicPoller } from './bnet-public-poller.service';
import { PUBLIC_POLL_ACTIVE_MS, PUBLIC_POLL_QUIET_MS } from './public-poll-interval';
import { PublicProfileGate } from './public-profile-gate';
import { bnetClientWithAppToken, EU, PUBLIC_QUERY } from './testing/bnet-nock';
import { InMemoryPublicPollStore } from './testing/in-memory-public-poll.store';

const START = Date.UTC(2026, 10, 7, 12);
const LAST_MODIFIED = 'Sat, 07 Nov 2026 11:40:00 GMT';
const LOGIN = new Date(START - 30 * 60_000);
const SWORD = [{ slot: 'MAIN_HAND', item: 1 }];

describe('BnetPublicPoller', () => {
  let now: number;
  let store: InMemoryPublicPollStore;
  let gate: PublicProfileGate;
  let emitter: EventEmitter2;
  let emitted: Array<{ name: string; payload: unknown }>;
  let poller: BnetPublicPoller;

  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());

  beforeEach(() => {
    nock.cleanAll();
    now = START;
    store = new InMemoryPublicPollStore();
    gate = new PublicProfileGate();
    gate.enable();
    emitter = new EventEmitter2({ wildcard: true });
    emitted = [];
    emitter.onAny((name, payload) => emitted.push({ name: String(name), payload }));
    poller = new BnetPublicPoller(store, bnetClientWithAppToken(START), emitter, gate, { now: () => now });
  });

  afterEach(() => {
    const pending = nock.pendingMocks().filter((m) => !m.includes('oauth.battle.net'));
    nock.cleanAll();
    expect(pending).toEqual([]);
  });

  const davina = () =>
    store.add({ characterId: 7n, ownerId: 'u1', role: 'main', region: 'eu', firstName: 'Davina', surname: 'Asaria' });

  it('does nothing while public readings are not enabled', async () => {
    const off = new BnetPublicPoller(store, bnetClientWithAppToken(START), emitter, new PublicProfileGate(), { now: () => now });
    davina();
    await off.pollDue();
    expect(store.rescheduled).toEqual([]);
    expect(emitted).toEqual([]);
    nock.cleanAll();
  });

  it('stores a bnet_public snapshot on 200, then sends If-Modified-Since and records nothing on 304', async () => {
    const c = davina();
    nock(EU)
      .get('/profile/wow/character/davina-asaria')
      .query(PUBLIC_QUERY)
      .reply(200, { level: 21, equipment: SWORD, last_login_timestamp: LOGIN.getTime() }, { 'Last-Modified': LAST_MODIFIED });

    await poller.pollDue();
    expect(c.snapshots).toEqual([expect.objectContaining({ level: 21, source: 'bnet_public', equipment: SWORD })]);
    expect(c.poll).toEqual({
      lastModified: LAST_MODIFIED,
      lastLoginAt: LOGIN,
      changedAt: new Date(START),
      nextPollAt: new Date(START + PUBLIC_POLL_ACTIVE_MS),
    });
    expect(emitted.map((e) => e.name)).toEqual(['character.updated']);
    expect((emitted[0].payload as CharacterUpdatedEvent).source).toBe('bnet_public');

    // Not due yet: no request.
    now = START + PUBLIC_POLL_ACTIVE_MS - 1;
    await poller.pollDue();

    now = START + PUBLIC_POLL_ACTIVE_MS;
    nock(EU, { reqheaders: { 'if-modified-since': LAST_MODIFIED } })
      .get('/profile/wow/character/davina-asaria')
      .query(PUBLIC_QUERY)
      .reply(304);
    emitted = [];
    await poller.pollDue();
    expect(c.snapshots).toHaveLength(1);
    expect(emitted).toEqual([]);
    expect(store.rescheduled).toEqual([{ characterId: 7n, nextPollAt: new Date(now + PUBLIC_POLL_ACTIVE_MS) }]);
  });

  it('records nothing on 404 and polls again later', async () => {
    const c = davina();
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(404);

    await poller.pollDue();
    expect(c.snapshots).toEqual([]);
    expect(emitted).toEqual([]);
    expect(store.rescheduled).toEqual([{ characterId: 7n, nextPollAt: new Date(START + PUBLIC_POLL_QUIET_MS) }]);
  });

  it('deduces level-ups and a session end stamped with last_login_timestamp', async () => {
    const c = davina();
    c.snapshots.push({ id: 1n, level: 21, capturedAt: new Date(START - 3 * 3_600_000), source: 'manual' });
    c.poll = {
      lastModified: 'Sat, 07 Nov 2026 08:00:00 GMT',
      lastLoginAt: new Date(START - 4 * 3_600_000),
      changedAt: null,
      nextPollAt: new Date(START),
    };
    nock(EU, { reqheaders: { 'if-modified-since': 'Sat, 07 Nov 2026 08:00:00 GMT' } })
      .get('/profile/wow/character/davina-asaria')
      .query(PUBLIC_QUERY)
      .reply(200, { level: 23, equipment: SWORD, last_login_timestamp: LOGIN.getTime() }, { 'Last-Modified': LAST_MODIFIED });

    await poller.pollDue();

    expect(emitted.map((e) => e.name)).toEqual(['character.updated', 'event.recorded', 'event.recorded', 'session.ended']);
    const levels = emitted.slice(1, 3).map((e) => e.payload as EventRecordedEvent);
    expect(levels.map((e) => [e.eventId, e.data, e.source])).toEqual([
      ['bnet-7-22', { level: 22 }, 'bnet_public'],
      ['bnet-7-23', { level: 23 }, 'bnet_public'],
    ]);
    const ended = emitted[3].payload as SessionEndedEvent;
    expect(ended).toEqual(
      expect.objectContaining({
        ownerId: 'u1',
        characterId: 7n,
        startedAt: LOGIN,
        endedAt: LOGIN,
        reason: 'bnet_logout',
        quiet: false,
      }),
    );
    expect(ended.recap).toEqual(expect.objectContaining({ durationSec: 0, levelStart: 21, levelEnd: 23, levelsGained: 2 }));
  });

  it('keeps polling the others when one character fails, and retries it later', async () => {
    davina();
    const other = store.add({ characterId: 8n, ownerId: 'u2', role: 'alt', region: 'eu', firstName: 'Bob', surname: 'Ross' });
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(500);
    nock(EU).get('/profile/wow/character/bob-ross').query(PUBLIC_QUERY).reply(200, { level: 12 });

    await poller.pollDue();
    expect(other.snapshots).toHaveLength(1);
    expect(store.rescheduled).toEqual([{ characterId: 7n, nextPollAt: new Date(START + PUBLIC_POLL_QUIET_MS) }]);
  });
});
