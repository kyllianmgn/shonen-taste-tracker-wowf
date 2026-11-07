import { RESTJSONErrorCodes, Routes } from 'discord.js';
import type { BoardMessagePayload, BoardPlayer } from '../render/board';
import { BoardPublisher } from './board-publisher';
import { FakeBoardRest } from './testing/fake-board-rest';
import { FakeBoardStore } from './testing/fake-board-store';

const GUILD = 'g1';
const BOARD = 'board-g1';
const LOGS = 'logs-g1';
const MIN_INTERVAL_MS = 15_000;
const TICK_MS = 5_000;

function player(index: number, level = 10): BoardPlayer {
  return {
    discordUserId: `1000000000000000${String(index).padStart(2, '0')}`,
    mode: 'app',
    privacy: { hideZone: false, hidePresence: false },
    presence: { online: false, lastSeenAt: null },
    main: {
      firstName: `Personnage${index}`,
      surname: 'Nomdefamillelong',
      classFile: 'PRIEST',
      snapshot: { level, xp: 100, xpMax: 1000, playedTotal: 3600, zone: 'Comté-de-l’Or' },
    },
    alt: null,
  };
}

function players(count: number): BoardPlayer[] {
  return Array.from({ length: count }, (_, i) => player(i));
}

function texts(body: unknown): string {
  return (body as BoardMessagePayload).components.flatMap((c) => c.components.map((t) => t.content)).join('\n');
}

describe('BoardPublisher', () => {
  let now: number;
  let rest: FakeBoardRest;
  let store: FakeBoardStore;
  let publisher: BoardPublisher;

  beforeEach(() => {
    now = Date.UTC(2026, 10, 6, 12, 0, 0);
    rest = new FakeBoardRest();
    store = new FakeBoardStore();
    publisher = new BoardPublisher(store, rest, { minEditIntervalMs: MIN_INTERVAL_MS, now: () => now });
  });

  /** One message already published by /setup (the provisional board). */
  function setupGuild(boardPlayers: BoardPlayer[] = [player(1)]): void {
    rest.channels.set(BOARD, new Map([['999', { provisional: true }]]));
    store.addGuild(GUILD, { boardMessageIds: ['999'], players: boardPlayers });
  }

  async function advance(ms: number): Promise<void> {
    now += ms;
    await publisher.tick();
  }

  it('does nothing for a guild nobody marked', async () => {
    setupGuild();

    await publisher.tick();

    expect(rest.calls).toEqual([]);
    expect(store.loads).toBe(0);
  });

  it('edits the existing board message of a marked guild', async () => {
    setupGuild();
    publisher.markDirty(GUILD);

    await publisher.tick();

    expect(rest.calls.map((c) => [c.method, c.route])).toEqual([['patch', Routes.channelMessage(BOARD, '999')]]);
    expect(texts(rest.messagesOf(BOARD)[0].body)).toContain('Personnage1 Nomdefamillelong');
    expect(store.guild(GUILD).boardMessageIds).toEqual(['999']);
  });

  it('marks the guilds of a player', async () => {
    setupGuild([player(1)]);
    store.addGuild('g2', { players: [player(2)] });
    store.addGuild('g3', { players: [player(1)], boardChannelId: null });

    await publisher.markPlayerDirty(player(1).discordUserId);
    await publisher.tick();

    expect(rest.calls.map((c) => c.route)).toEqual([Routes.channelMessage(BOARD, '999')]);
  });

  it('keeps at most one edit per 15 s during a burst of 50 changes', async () => {
    setupGuild();
    const edits: number[] = [];
    const start = now;

    // 50 syncs over 10 s (one every 200 ms), each changing the level; the job ticks every 5 s.
    for (let i = 0; i < 50; i++) {
      now = start + i * 200;
      store.guild(GUILD).players = [player(1, 10 + i)];
      publisher.markDirty(GUILD);
      if (i % 25 === 0) {
        const before = rest.calls.length;
        await publisher.tick();
        if (rest.calls.length > before) edits.push(now);
      }
    }
    for (let t = start + 10_000; t <= start + 60_000; t += TICK_MS) {
      now = t;
      const before = rest.calls.length;
      await publisher.tick();
      if (rest.calls.length > before) edits.push(now);
    }

    expect(rest.calls.every((c) => c.method === 'patch')).toBe(true);
    expect(edits.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < edits.length; i++) expect(edits[i] - edits[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    // The last change is on the board once the burst is over.
    expect(texts(rest.messagesOf(BOARD)[0].body)).toContain('Prêtre 59');
  });

  it('waits for the interval, then redraws a guild marked right after an edit', async () => {
    setupGuild();
    publisher.markDirty(GUILD);
    await publisher.tick();
    store.guild(GUILD).players = [player(1, 11)];
    publisher.markDirty(GUILD);
    rest.reset();

    await advance(TICK_MS);
    await advance(TICK_MS);
    expect(rest.calls).toEqual([]);

    await advance(TICK_MS);
    expect(rest.calls).toHaveLength(1);
  });

  it('sends nothing when the render is identical to the previous one', async () => {
    setupGuild();
    publisher.markDirty(GUILD);
    await publisher.tick();
    rest.reset();

    // Same data later: only the « Mis à jour » time would differ.
    now += 60_000;
    publisher.markDirty(GUILD);
    await publisher.tick();

    expect(rest.calls).toEqual([]);
  });

  it('does not count a skipped identical render as an edit', async () => {
    setupGuild();
    publisher.markDirty(GUILD);
    await publisher.tick();
    await advance(MIN_INTERVAL_MS);
    publisher.markDirty(GUILD);
    await publisher.tick(); // identical: nothing sent
    store.guild(GUILD).players = [player(1, 11)];
    publisher.markDirty(GUILD);
    rest.reset();

    await advance(TICK_MS);

    expect(rest.calls).toHaveLength(1);
  });

  it('grows from 1 to 2 messages and back, keeping board_message_ids in order', async () => {
    setupGuild(players(60));
    publisher.markDirty(GUILD);

    await publisher.tick();

    expect(rest.calls.map((c) => c.method)).toEqual(['patch', 'post']);
    const grown = rest.messagesOf(BOARD);
    expect(grown).toHaveLength(2);
    expect(store.guild(GUILD).boardMessageIds).toEqual(grown.map((m) => m.id));
    expect(grown[0].id).toBe('999');
    expect(texts(grown[0].body)).toContain('WoW: Forever — 60 joueurs suivis');
    expect(texts(grown[1].body)).toContain('Mis à jour');

    store.guild(GUILD).players = players(3);
    publisher.markDirty(GUILD);
    rest.reset();
    await advance(MIN_INTERVAL_MS);

    expect(rest.calls.map((c) => [c.method, c.route])).toEqual([
      ['patch', Routes.channelMessage(BOARD, '999')],
      ['delete', Routes.channelMessage(BOARD, grown[1].id)],
    ]);
    expect(rest.messagesOf(BOARD).map((m) => m.id)).toEqual(['999']);
    expect(store.guild(GUILD).boardMessageIds).toEqual(['999']);
  });

  it('publishes a new message when the board has no message yet', async () => {
    store.addGuild(GUILD, { boardMessageIds: [], players: [player(1)] });
    publisher.markDirty(GUILD);

    await publisher.tick();

    const [message] = rest.messagesOf(BOARD);
    expect(rest.calls.map((c) => c.method)).toEqual(['post']);
    expect(store.guild(GUILD).boardMessageIds).toEqual([message.id]);
  });

  describe('recovery', () => {
    it('10008 on edit: republishes and remembers the new id', async () => {
      setupGuild();
      rest.deleteByHand(BOARD, '999');
      publisher.markDirty(GUILD);

      await publisher.tick();

      const messages = rest.messagesOf(BOARD);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).not.toBe('999');
      expect(store.guild(GUILD).boardMessageIds).toEqual([messages[0].id]);
      expect(rest.messagesOf(LOGS)).toEqual([]);
    });

    it('10008 on the first of two messages: republishes both so the order stays right', async () => {
      setupGuild(players(60));
      publisher.markDirty(GUILD);
      await publisher.tick();
      const [, second] = rest.messagesOf(BOARD);
      rest.deleteByHand(BOARD, '999');
      store.guild(GUILD).players = [...players(59), player(59, 30)];
      publisher.markDirty(GUILD);
      rest.reset();

      await advance(MIN_INTERVAL_MS);

      const messages = rest.messagesOf(BOARD);
      expect(messages).toHaveLength(2);
      expect(messages.map((m) => m.id)).not.toContain(second.id);
      expect(store.guild(GUILD).boardMessageIds).toEqual(messages.map((m) => m.id));
      expect(texts(messages[0].body)).toContain('WoW: Forever');
    });

    it('10008 on delete of an extra message is not an error', async () => {
      setupGuild(players(60));
      publisher.markDirty(GUILD);
      await publisher.tick();
      const [, second] = rest.messagesOf(BOARD);
      rest.deleteByHand(BOARD, second.id);
      store.guild(GUILD).players = players(2);
      publisher.markDirty(GUILD);

      await advance(MIN_INTERVAL_MS);

      expect(store.guild(GUILD).boardMessageIds).toEqual(['999']);
      expect(store.guild(GUILD).boardChannelId).toBe(BOARD);
    });

    it.each([
      [RESTJSONErrorCodes.UnknownChannel, 'introuvable'],
      [RESTJSONErrorCodes.MissingPermissions, 'permissions'],
    ])('%i: disables the board and warns in the logs channel', async (code, wording) => {
      setupGuild();
      rest.failNext('patch', code);
      publisher.markDirty(GUILD);

      await publisher.tick();

      expect(store.guild(GUILD).boardChannelId).toBeNull();
      expect(store.guild(GUILD).boardMessageIds).toEqual([]);
      const [notice] = rest.messagesOf(LOGS);
      const content = (notice.body as { content: string }).content;
      expect(content).toContain(`<#${BOARD}>`);
      expect(content).toContain(wording);
      expect(content).toContain('/setup');
      expect((notice.body as { allowed_mentions: unknown }).allowed_mentions).toEqual({ parse: [] });

      // Disabled: later changes send nothing.
      rest.reset();
      publisher.markDirty(GUILD);
      await advance(MIN_INTERVAL_MS);
      expect(rest.calls).toEqual([]);
    });

    it.each([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingPermissions])(
      '%i on publishing a new message disables the board too',
      async (code) => {
        store.addGuild(GUILD, { boardMessageIds: [], players: [player(1)] });
        rest.failNext('post', code, Routes.channelMessages(BOARD));
        publisher.markDirty(GUILD);

        await publisher.tick();

        expect(store.guild(GUILD).boardChannelId).toBeNull();
        expect(rest.messagesOf(LOGS)).toHaveLength(1);
      },
    );

    it('disables the board quietly when there is no logs channel', async () => {
      setupGuild();
      store.guild(GUILD).logsChannelId = null;
      rest.failNext('patch', RESTJSONErrorCodes.MissingPermissions);
      publisher.markDirty(GUILD);

      await publisher.tick();

      expect(store.guild(GUILD).boardChannelId).toBeNull();
    });

    it('still disables the board when the logs notice cannot be posted', async () => {
      setupGuild();
      rest.failNext('patch', RESTJSONErrorCodes.MissingPermissions);
      rest.failNext('post', RESTJSONErrorCodes.MissingPermissions, Routes.channelMessages(LOGS));
      publisher.markDirty(GUILD);

      await expect(publisher.tick()).resolves.toBeUndefined();

      expect(store.guild(GUILD).boardChannelId).toBeNull();
    });

    it('keeps the guild marked after another error and retries after the interval', async () => {
      setupGuild();
      rest.failNext('patch', RESTJSONErrorCodes.UnknownGuild);
      publisher.markDirty(GUILD);

      await expect(publisher.tick()).resolves.toBeUndefined();
      expect(store.guild(GUILD).boardChannelId).toBe(BOARD);
      rest.reset();

      await advance(TICK_MS);
      expect(rest.calls).toEqual([]);
      await advance(MIN_INTERVAL_MS - TICK_MS);
      expect(rest.calls.map((c) => c.method)).toEqual(['patch']);
    });
  });

  describe('startup and /setup', () => {
    it('redraws every board on the first tick after markAllDirty', async () => {
      setupGuild();
      store.addGuild('g2', { players: [player(2)] });
      store.addGuild('g3', { boardChannelId: null });

      publisher.markAllDirty();
      await publisher.tick();

      expect(rest.messagesOf(BOARD)).toHaveLength(1);
      expect(rest.messagesOf('board-g2')).toHaveLength(1);
      expect(rest.calls.filter((c) => c.route.includes('board-g3'))).toEqual([]);
    });

    it('invalidate forgets the previous render, so the same data is sent again', async () => {
      setupGuild();
      publisher.markDirty(GUILD);
      await publisher.tick();
      rest.reset();

      publisher.invalidate(GUILD);
      await advance(MIN_INTERVAL_MS);

      expect(rest.calls.map((c) => c.method)).toEqual(['patch']);
    });

    it('does not run two ticks at the same time', async () => {
      setupGuild();
      publisher.markDirty(GUILD);

      await Promise.all([publisher.tick(), publisher.tick()]);

      expect(rest.calls).toHaveLength(1);
    });
  });

  describe('/admin rafraichir (republish)', () => {
    it('deletes every board message, then publishes the board again as new messages', async () => {
      setupGuild(players(60));
      publisher.markDirty(GUILD);
      await publisher.tick();
      const before = store.guild(GUILD).boardMessageIds;
      expect(before.length).toBeGreaterThan(1);
      rest.reset();

      publisher.republish(GUILD);
      await advance(MIN_INTERVAL_MS);

      expect(rest.calls.filter((c) => c.method === 'delete').map((c) => c.route)).toEqual(
        expect.arrayContaining(before.map((id) => Routes.channelMessage(BOARD, id))),
      );
      expect(rest.calls.filter((c) => c.method === 'patch')).toEqual([]);
      const after = store.guild(GUILD).boardMessageIds;
      expect(after).toHaveLength(before.length);
      expect(after.some((id) => before.includes(id))).toBe(false);
      expect(rest.messagesOf(BOARD).map((m) => m.id)).toEqual(after);
    });

    it('republishes even when the render did not change', async () => {
      setupGuild();
      publisher.markDirty(GUILD);
      await publisher.tick();
      rest.reset();

      publisher.republish(GUILD);
      await advance(MIN_INTERVAL_MS);

      expect(rest.calls.map((c) => c.method)).toEqual(['delete', 'post']);
    });

    it('still waits for the minimum interval since the last edit', async () => {
      setupGuild();
      publisher.markDirty(GUILD);
      await publisher.tick();
      rest.reset();

      publisher.republish(GUILD);
      await advance(TICK_MS);
      expect(rest.calls).toEqual([]);

      await advance(MIN_INTERVAL_MS - TICK_MS);
      expect(rest.calls.map((c) => c.method)).toEqual(['delete', 'post']);
    });

    it('ignores a board message already deleted by hand', async () => {
      setupGuild();
      publisher.markDirty(GUILD);
      await publisher.tick();
      rest.deleteByHand(BOARD, '999');

      publisher.republish(GUILD);
      await advance(MIN_INTERVAL_MS);

      expect(rest.messagesOf(BOARD)).toHaveLength(1);
      expect(store.guild(GUILD).boardMessageIds).toEqual([rest.messagesOf(BOARD)[0].id]);
    });

    it('retries the whole republish after a network failure', async () => {
      setupGuild();
      publisher.markDirty(GUILD);
      await publisher.tick();
      rest.failNext('post', 500 as RESTJSONErrorCodes);

      publisher.republish(GUILD);
      await advance(MIN_INTERVAL_MS);
      expect(rest.messagesOf(BOARD)).toHaveLength(0);
      expect(store.guild(GUILD).boardMessageIds).toEqual([]);

      await advance(MIN_INTERVAL_MS);
      expect(rest.messagesOf(BOARD)).toHaveLength(1);
      expect(store.guild(GUILD).boardMessageIds).toEqual([rest.messagesOf(BOARD)[0].id]);
    });
  });
});
