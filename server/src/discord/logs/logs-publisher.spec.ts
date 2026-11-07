import { RESTJSONErrorCodes, Routes } from 'discord.js';
import type { EventRecordedEvent } from '../../ingest/sync/sync.events';
import type { SessionEndedEvent, SessionStartedEvent } from '../../presence/presence.events';
import type { SessionRecap } from '../../presence/session-recap';
import { FakeBoardRest } from '../board/testing/fake-board-rest';
import { LOG_GROUP_WINDOW_MS, LOG_SEND_INTERVAL_MS, LogsPublisher } from './logs-publisher';
import { FakeLogsStore } from './testing/fake-logs-store';

const KYLLIAN = '100000000000000001';
const LINA = '100000000000000002';
const DAVINA = 1n;
const ILSA = 2n;
const LOGS = 'logs-g1';
const START = Date.UTC(2026, 10, 7, 20, 0, 0);

interface Content {
  content: string;
  allowed_mentions: unknown;
}

describe('LogsPublisher', () => {
  let now: number;
  let rest: FakeBoardRest;
  let store: FakeLogsStore;
  let publisher: LogsPublisher;
  let nextEventId: bigint;

  beforeEach(() => {
    now = START;
    nextEventId = 100n;
    rest = new FakeBoardRest();
    store = new FakeLogsStore();
    store.addGuild('g1');
    store.addPlayer(KYLLIAN, ['g1']);
    store.addPlayer(LINA, ['g1']);
    store.addCharacter(DAVINA);
    store.addCharacter(ILSA, { firstName: 'Ilsa', surname: 'Ventbrume', level: 19 });
    publisher = newPublisher();
  });

  function newPublisher(): LogsPublisher {
    return new LogsPublisher(store, rest, { now: () => now });
  }

  function event(type: string, data: Record<string, unknown>, overrides: Partial<EventRecordedEvent> = {}): EventRecordedEvent {
    return {
      id: nextEventId++,
      characterId: DAVINA,
      ownerId: KYLLIAN,
      role: 'main',
      eventId: `addon-${nextEventId}`,
      type,
      at: new Date(now - 60_000),
      data,
      source: 'app',
      flags: [],
      ...overrides,
    };
  }

  const levelUp = (level: number, overrides: Partial<EventRecordedEvent> = {}) => event('LEVEL_UP', { level }, overrides);

  function started(ownerId = KYLLIAN, characterId: bigint | null = DAVINA): SessionStartedEvent {
    return { sessionId: 1n, ownerId, characterId, startedAt: new Date(now) };
  }

  function recap(overrides: Partial<SessionRecap> = {}): SessionRecap {
    return {
      durationSec: 3_600,
      levelStart: 21,
      levelEnd: 23,
      levelsGained: 2,
      moneyDelta: 380_000,
      playedAddedSec: 3_600,
      endZone: 'Bois de la Pénombre',
      endSubZone: 'Darkshire',
      deaths: 0,
      ...overrides,
    };
  }

  function ended(overrides: Partial<SessionEndedEvent> = {}): SessionEndedEvent {
    return {
      sessionId: 1n,
      ownerId: KYLLIAN,
      characterId: DAVINA,
      startedAt: new Date(now - 3_600_000),
      endedAt: new Date(now),
      reason: 'game_closed',
      recap: recap(),
      quiet: false,
      ...overrides,
    };
  }

  /** Moves the clock by `ms`, running the send job every 500 ms like LogsSendJob. */
  async function advance(ms: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      now += Math.min(500, ms - elapsed);
      await publisher.tick();
    }
  }

  const posted = (channelId = LOGS) => rest.messagesOf(channelId).map((m) => (m.body as Content).content);

  describe('sending', () => {
    it('posts a player line once the player has been quiet for 10 s, without pinging anyone', async () => {
      await publisher.onSessionStarted(started());

      await advance(LOG_GROUP_WINDOW_MS - 500);
      expect(rest.calls).toEqual([]);

      await advance(500);
      expect(rest.calls.map((c) => c.route)).toEqual([Routes.channelMessages(LOGS)]);
      expect(rest.calls[0].body).toEqual({
        content: `🟢 <@${KYLLIAN}> est en jeu — Davina Asaria (niv. 23)`,
        allowed_mentions: { parse: [] },
      });
    });

    it('groups the events of one player arriving less than 10 s apart, in event order', async () => {
      await publisher.onEventRecorded(levelUp(25, { at: new Date(now - 10_000) }));
      await advance(6_000);
      await publisher.onEventRecorded(levelUp(24, { at: new Date(now - 50_000) }));
      await advance(9_500);
      expect(rest.calls).toEqual([]);

      await advance(500);
      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 24\n⬆️ Davina Asaria passe niveau 25']);
    });

    it('keeps events 10 s apart or more in separate messages', async () => {
      await publisher.onEventRecorded(levelUp(24));
      await advance(LOG_GROUP_WINDOW_MS);
      await publisher.onEventRecorded(levelUp(25));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 24', '⬆️ Davina Asaria passe niveau 25']);
    });

    it('never groups two players and sends at most one message every 1.5 s per channel', async () => {
      await publisher.onSessionStarted(started(KYLLIAN, DAVINA));
      await publisher.onSessionStarted(started(LINA, ILSA));

      await advance(LOG_GROUP_WINDOW_MS);
      expect(posted()).toEqual([`🟢 <@${KYLLIAN}> est en jeu — Davina Asaria (niv. 23)`]);

      await advance(LOG_SEND_INTERVAL_MS - 500);
      expect(posted()).toHaveLength(1);
      await advance(500);
      expect(posted()).toEqual([
        `🟢 <@${KYLLIAN}> est en jeu — Davina Asaria (niv. 23)`,
        `🟢 <@${LINA}> est en jeu — Ilsa Ventbrume (niv. 19)`,
      ]);
    });

    it('posts in every guild of the player that has a logs channel, and claims the event once', async () => {
      store.addGuild('g2', { logsChannelId: 'logs-g2' });
      store.addPlayer(KYLLIAN, ['g1', 'g2', 'g3']);
      const recorded = levelUp(24);

      await publisher.onEventRecorded(recorded);
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 24']);
      expect(posted('logs-g2')).toEqual(['⬆️ Davina Asaria passe niveau 24']);
      expect(store.publishedAt(recorded.id)).toEqual(new Date(START));
    });

    it('splits a group that would exceed the Discord limit', async () => {
      for (let level = 2; level <= 59; level++) await publisher.onEventRecorded(levelUp(level, { data: { level, playedTotal: 3_600 * level } }));
      await advance(LOG_GROUP_WINDOW_MS + LOG_SEND_INTERVAL_MS);

      const messages = posted();
      expect(messages.length).toBe(2);
      expect(messages.every((m) => m.length <= 2000)).toBe(true);
      expect(messages.join('\n').split('\n')).toHaveLength(58);
    });

    it('drops the queue of a channel the bot can no longer write to', async () => {
      await publisher.onSessionStarted(started(KYLLIAN));
      await publisher.onSessionStarted(started(LINA, ILSA));
      rest.failNext('post', RESTJSONErrorCodes.MissingPermissions);

      await advance(LOG_GROUP_WINDOW_MS + 3 * LOG_SEND_INTERVAL_MS);

      expect(rest.calls).toHaveLength(1);
      expect(posted()).toEqual([]);
    });

    it('retries a message after another Discord error', async () => {
      await publisher.onSessionStarted(started());
      rest.failNext('post', 500 as RESTJSONErrorCodes);

      await advance(LOG_GROUP_WINDOW_MS + LOG_SEND_INTERVAL_MS);

      expect(rest.calls).toHaveLength(2);
      expect(posted()).toHaveLength(1);
    });

    it('flush sends every waiting message at once (shutdown)', async () => {
      await publisher.onSessionStarted(started(KYLLIAN));
      await publisher.onSessionStarted(started(LINA, ILSA));

      await publisher.flush();

      expect(posted()).toHaveLength(2);
    });
  });

  describe('sessions', () => {
    it('posts the end of session with its recap', async () => {
      await publisher.onSessionEnded(ended());
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⚫ Davina Asaria : 1 h de jeu · niv. 21 → 23 · +38 po · fin à Darkshire']);
    });

    it('posts the short form for a base-mode session end deduced from Battle.net', async () => {
      await publisher.onSessionEnded(ended({ reason: 'bnet_logout' }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⚫ Davina Asaria : niv. 21 → 23']);
    });

    it('posts nothing for a quiet session', async () => {
      await publisher.onSessionEnded(ended({ quiet: true }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(rest.calls).toEqual([]);
    });

    it('hide_presence hides the start of session and the duration of its end', async () => {
      store.addPlayer(KYLLIAN, ['g1'], { hidePresence: true });

      await publisher.onSessionStarted(started());
      await publisher.onSessionEnded(ended());
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⚫ Davina Asaria : niv. 21 → 23 · +38 po · fin à Darkshire']);
    });

    it('applies hide_money and hide_zone to the recap', async () => {
      store.addPlayer(KYLLIAN, ['g1'], { hideMoney: true, hideZone: true });

      await publisher.onSessionEnded(ended());
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⚫ Davina Asaria : 1 h de jeu · niv. 21 → 23']);
    });

    it('never names an untracked character', async () => {
      store.addCharacter(DAVINA, { role: 'untracked' });

      await publisher.onSessionStarted(started());
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual([`🟢 <@${KYLLIAN}> est en jeu`]);
    });
  });

  describe('game events', () => {
    it('follows level_announce_step and always announces the 60 once', async () => {
      store.addGuild('g1', { levelAnnounceStep: 5 });

      await publisher.onEventRecorded(levelUp(24));
      await publisher.onEventRecorded(levelUp(25));
      await publisher.onEventRecorded(event('LEVEL_UP', { level: 60, playedTotal: 220 * 3_600 }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 25\n🏆 Davina Asaria atteint le niveau 60 en 9 j 4 h de jeu']);
    });

    it('posts deaths only where log_deaths is on, and leaves an unposted death unclaimed', async () => {
      const death = event('DEATH', { level: 23, zone: 'Duskwood' });
      await publisher.onEventRecorded(death);
      await advance(LOG_GROUP_WINDOW_MS);
      expect(rest.calls).toEqual([]);
      expect(store.publishedAt(death.id)).toBeNull();

      store.addGuild('g1', { logDeaths: true });
      await publisher.onEventRecorded(event('DEATH', { level: 23, zone: 'Duskwood' }));
      await advance(LOG_GROUP_WINDOW_MS);
      expect(posted()).toEqual(['💀 Davina Asaria est morte à Duskwood (niv. 23)']);
    });

    it('hides the death zone with hide_zone', async () => {
      store.addGuild('g1', { logDeaths: true });
      store.addPlayer(KYLLIAN, ['g1'], { hideZone: true });

      await publisher.onEventRecorded(event('DEATH', { level: 23, zone: 'Duskwood' }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['💀 Davina Asaria est morte (niv. 23)']);
    });

    it('posts dungeon entries, except with hide_zone', async () => {
      await publisher.onEventRecorded(event('DUNGEON_ENTER', { instanceName: 'Les Mortemines', instanceId: 36 }));
      await advance(LOG_GROUP_WINDOW_MS);
      expect(posted()).toEqual(['🏰 Davina Asaria entre dans Les Mortemines']);

      store.addPlayer(KYLLIAN, ['g1'], { hideZone: true });
      const hidden = event('DUNGEON_ENTER', { instanceName: 'Ombrecroc', instanceId: 33 });
      await publisher.onEventRecorded(hidden);
      await advance(LOG_GROUP_WINDOW_MS);
      expect(posted()).toEqual(['🏰 Davina Asaria entre dans Les Mortemines']);
      expect(store.publishedAt(hidden.id)).toBeNull();
    });

    it('posts guild joins', async () => {
      await publisher.onEventRecorded(event('GUILD_CHANGE', { to: 'Les Veilleurs' }));
      await publisher.onEventRecorded(event('GUILD_CHANGE', { from: 'Les Veilleurs' }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['Davina Asaria rejoint \\<Les Veilleurs>']);
    });

    it('never posts flagged events', async () => {
      const flagged = levelUp(24, { flags: ['suspect_level_jump'] });
      await publisher.onEventRecorded(flagged);
      await advance(LOG_GROUP_WINDOW_MS);

      expect(rest.calls).toEqual([]);
      expect(store.publishedAt(flagged.id)).toBeNull();
    });

    it('never posts events received more than 24 h after their time', async () => {
      await publisher.onEventRecorded(levelUp(24, { at: new Date(now - 24 * 3_600_000 - 1_000) }));
      await publisher.onEventRecorded(levelUp(25, { at: new Date(now - 23 * 3_600_000) }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 25']);
    });

    it('never posts events of untracked characters', async () => {
      await publisher.onEventRecorded(levelUp(24, { role: 'untracked' }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(rest.calls).toEqual([]);
    });

    it('posts nothing when the player has no guild with a logs channel', async () => {
      store.guilds.delete('g1');

      await publisher.onEventRecorded(levelUp(24));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(rest.calls).toEqual([]);
    });
  });

  describe('published_at', () => {
    it('posts an event delivered twice only once', async () => {
      const recorded = levelUp(24);

      await publisher.onEventRecorded(recorded);
      await publisher.onEventRecorded(recorded);
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 24']);
    });

    it('never republishes after a restart, even a level recorded again by another source', async () => {
      const fromBnet = levelUp(24, { eventId: `bnet-${DAVINA}-24`, source: 'bnet_account' });
      await publisher.onEventRecorded(fromBnet);
      await advance(LOG_GROUP_WINDOW_MS);
      expect(posted()).toHaveLength(1);

      // Restart: the in-memory queue is gone, the database stays.
      publisher = newPublisher();
      await publisher.onEventRecorded(fromBnet);
      await publisher.onEventRecorded(levelUp(24, { source: 'manual' }));
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual(['⬆️ Davina Asaria passe niveau 24']);
    });
  });

  describe('tracked characters', () => {
    it('posts the new main or alt of a member', async () => {
      await publisher.onCharacterTracked({ characterId: ILSA, ownerId: LINA, role: 'alt', firstName: 'Ilsa', surname: 'Ventbrume' });
      await advance(LOG_GROUP_WINDOW_MS);

      expect(posted()).toEqual([`➕ <@${LINA}> suit Ilsa Ventbrume (secondaire)`]);
    });
  });
});
