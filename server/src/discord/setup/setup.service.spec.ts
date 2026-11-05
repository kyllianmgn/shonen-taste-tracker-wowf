import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { COMPONENT_TYPE_CONTAINER, COMPONENT_TYPE_TEXT_DISPLAY, IS_COMPONENTS_V2 } from '../render/board';
import { BOARD_BOT_ALLOW, BOARD_EVERYONE_DENY, boardOverwrites } from './board-permissions';
import { provisionalBoard } from './provisional-board';
import { BOARD_CHANNEL_NAME, LOGS_CHANNEL_NAME, SetupService, formatSetupReply, type SetupOutcome } from './setup.service';
import { FakeChannel, FakeGuild, FakeGuildConfigStore } from './testing/fake-setup-guild';

const ALL = PermissionsBitField.All;
const LOCKED = BOARD_EVERYONE_DENY.reduce((a, f) => a | f, 0n);

function setup() {
  const guild = new FakeGuild();
  const store = new FakeGuildConfigStore();
  const service = new SetupService(store);
  return { guild, store, service };
}

function expectOk(outcome: SetupOutcome): Extract<SetupOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.reason}`);
  return outcome;
}

describe('provisionalBoard', () => {
  it('is one Components V2 container with a French text display and no pings', () => {
    const payload = provisionalBoard();
    expect(payload.flags & IS_COMPONENTS_V2).toBe(IS_COMPONENTS_V2);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0].type).toBe(COMPONENT_TYPE_CONTAINER);
    expect(payload.components[0].components.map((c) => c.type)).toEqual([COMPONENT_TYPE_TEXT_DISPLAY]);
    expect(payload.components[0].components[0].content).toMatch(/^## WoW: Forever/);
    expect(payload.components[0].components[0].content).toMatch(/\/perso ajouter/);
  });
});

describe('SetupService', () => {
  describe('first run without options', () => {
    it('creates #tableau-forever locked and #logs-forever without overwrites', async () => {
      const { guild, service } = setup();

      const outcome = expectOk(await service.run(guild, {}));

      expect(guild.created.map((c) => c.name)).toEqual([BOARD_CHANNEL_NAME, LOGS_CHANNEL_NAME]);
      const [board, logs] = guild.created;
      expect(board.overwrites).toEqual(boardOverwrites(guild.everyoneRoleId, guild.botUserId));
      expect(logs.overwrites).toEqual([]);
      expect(outcome.board).toEqual({ channelId: board.id, created: true });
      expect(outcome.logs).toEqual({ channelId: logs.id, created: true });
      expect(outcome.boardLockGaps).toEqual([]);
      expect(outcome.logsMissing).toEqual([]);
    });

    it('publishes the provisional board and stores its id in guild_config', async () => {
      const { guild, store, service } = setup();

      const outcome = expectOk(await service.run(guild, {}));

      const [board, logs] = guild.created;
      expect(board.sent).toHaveLength(1);
      expect(board.messages.get(board.sent[0])).toEqual(provisionalBoard());
      expect(logs.sent).toEqual([]);
      expect(outcome.boardMessage).toBe('published');
      expect(store.rows.get('g1')).toEqual({
        boardChannelId: board.id,
        logsChannelId: logs.id,
        boardMessageIds: [board.sent[0]],
      });
    });
  });

  describe('running /setup again', () => {
    it('duplicates nothing: same channels, board message edited in place', async () => {
      const { guild, store, service } = setup();
      await service.run(guild, {});
      const first = store.rows.get('g1');

      const outcome = expectOk(await service.run(guild, {}));

      expect(guild.created).toHaveLength(2);
      const [board] = guild.created;
      expect(board.sent).toHaveLength(1);
      expect(board.edited).toEqual([board.sent[0]]);
      expect(outcome.board.created).toBe(false);
      expect(outcome.logs.created).toBe(false);
      expect(outcome.boardMessage).toBe('edited');
      expect(store.rows.get('g1')).toEqual(first);
    });

    it('reposts the board when its message was deleted, and keeps the new id only', async () => {
      const { guild, store, service } = setup();
      await service.run(guild, {});
      const [board] = guild.created;
      board.messages.clear();

      const outcome = expectOk(await service.run(guild, {}));

      expect(board.sent).toHaveLength(2);
      expect(outcome.boardMessage).toBe('published');
      expect(store.rows.get('g1')?.boardMessageIds).toEqual([board.sent[1]]);
    });

    it('reuses channels found by name when guild_config was lost', async () => {
      const { guild, store, service } = setup();
      await service.run(guild, {});
      store.rows.clear();

      const outcome = expectOk(await service.run(guild, {}));

      expect(guild.created).toHaveLength(2);
      expect(outcome.board.created).toBe(false);
      expect(store.rows.get('g1')?.boardChannelId).toBe(guild.created[0].id);
    });

    it('recreates a configured channel that was deleted', async () => {
      const { guild, store, service } = setup();
      await service.run(guild, {});
      const oldBoard = guild.created[0];
      guild.channels.delete(oldBoard.id);

      const outcome = expectOk(await service.run(guild, {}));

      expect(guild.created.map((c) => c.name)).toEqual([BOARD_CHANNEL_NAME, LOGS_CHANNEL_NAME, BOARD_CHANNEL_NAME]);
      expect(outcome.board).toEqual({ channelId: guild.created[2].id, created: true });
      expect(store.rows.get('g1')?.boardChannelId).toBe(guild.created[2].id);
    });
  });

  describe('channels given as options', () => {
    it('uses them without creating anything and without touching their permissions', async () => {
      const { guild, store, service } = setup();
      const board = guild.addChannel(new FakeChannel('b1', 'mon-tableau', LOCKED));
      const logs = guild.addChannel(new FakeChannel('l1', 'mes-logs'));

      const outcome = expectOk(await service.run(guild, { boardChannelId: 'b1', logsChannelId: 'l1' }));

      expect(guild.created).toEqual([]);
      expect(board.overwrites).toEqual([]);
      expect(outcome.board).toEqual({ channelId: 'b1', created: false });
      expect(outcome.boardLockGaps).toEqual([]);
      expect(board.sent).toHaveLength(1);
      expect(store.rows.get('g1')).toEqual({ boardChannelId: 'b1', logsChannelId: 'l1', boardMessageIds: [board.sent[0]] });
      expect(logs.sent).toEqual([]);
    });

    it('reports the @everyone locks missing on a given board channel', async () => {
      const { guild, service } = setup();
      guild.addChannel(new FakeChannel('b1', 'mon-tableau', P.SendMessages | P.AddReactions));

      const outcome = expectOk(await service.run(guild, { boardChannelId: 'b1' }));

      expect(outcome.boardLockGaps).toEqual([P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads]);
    });

    it('creates only the channel that was not given', async () => {
      const { guild, service } = setup();
      guild.addChannel(new FakeChannel('l1', 'mes-logs'));

      const outcome = expectOk(await service.run(guild, { logsChannelId: 'l1' }));

      expect(guild.created.map((c) => c.name)).toEqual([BOARD_CHANNEL_NAME]);
      expect(outcome.logs).toEqual({ channelId: 'l1', created: false });
    });

    it('moves the board: posts in the new channel and deletes the old message', async () => {
      const { guild, store, service } = setup();
      await service.run(guild, {});
      const oldBoard = guild.created[0];
      const oldMessage = oldBoard.sent[0];
      const board = guild.addChannel(new FakeChannel('b2', 'nouveau-tableau', LOCKED));

      expectOk(await service.run(guild, { boardChannelId: 'b2' }));

      expect(oldBoard.deleted).toEqual([oldMessage]);
      expect(store.rows.get('g1')).toMatchObject({ boardChannelId: 'b2', boardMessageIds: [board.sent[0]] });
    });

    it('refuses an unknown or hidden channel and changes nothing', async () => {
      const { guild, store, service } = setup();
      guild.addChannel(new FakeChannel('hid', 'secret'));
      guild.hidden.add('hid');

      expect(await service.run(guild, { boardChannelId: 'nope' })).toEqual({
        ok: false,
        reason: 'channel_not_found',
        option: 'tableau',
      });
      expect(await service.run(guild, { logsChannelId: 'hid' })).toEqual({
        ok: false,
        reason: 'channel_not_found',
        option: 'logs',
      });
      expect(guild.created).toEqual([]);
      expect(store.saves).toBe(0);
    });

    it('refuses the same channel for the board and the logs', async () => {
      const { guild, store, service } = setup();
      guild.addChannel(new FakeChannel('x', 'tout'));

      expect(await service.run(guild, { boardChannelId: 'x', logsChannelId: 'x' })).toEqual({
        ok: false,
        reason: 'same_channel',
      });
      expect(store.saves).toBe(0);
    });

    it('refuses a board channel where the bot cannot publish', async () => {
      const { guild, store, service } = setup();
      const board = guild.addChannel(new FakeChannel('b1', 'mon-tableau', LOCKED, P.ViewChannel | P.SendMessages));

      expect(await service.run(guild, { boardChannelId: 'b1' })).toEqual({
        ok: false,
        reason: 'board_unusable',
        channelId: 'b1',
        missing: [P.EmbedLinks, P.ReadMessageHistory],
      });
      expect(board.sent).toEqual([]);
      expect(guild.created).toEqual([]);
      expect(store.saves).toBe(0);
    });

    it('warns when the bot cannot post in the logs channel', async () => {
      const { guild, service } = setup();
      guild.addChannel(new FakeChannel('l1', 'mes-logs', 0n, P.ViewChannel));

      const outcome = expectOk(await service.run(guild, { logsChannelId: 'l1' }));

      expect(outcome.logsMissing).toEqual([P.SendMessages, P.EmbedLinks]);
    });
  });

  describe('bot permissions on the server', () => {
    it('refuses without Manage Channels, before creating or saving anything', async () => {
      const { guild, store, service } = setup();
      guild.botPermissionBits = ALL & ~P.ManageChannels;

      expect(await service.run(guild, {})).toEqual({
        ok: false,
        reason: 'missing_guild_permissions',
        missing: [P.ManageChannels],
      });
      expect(guild.created).toEqual([]);
      expect(store.saves).toBe(0);
    });

    it('refuses without Manage Channels even when both channels are given', async () => {
      const { guild, store, service } = setup();
      guild.botPermissionBits = ALL & ~P.ManageChannels;
      const board = guild.addChannel(new FakeChannel('b1', 'mon-tableau', LOCKED));
      guild.addChannel(new FakeChannel('l1', 'mes-logs'));

      const outcome = await service.run(guild, { boardChannelId: 'b1', logsChannelId: 'l1' });

      expect(outcome).toMatchObject({ ok: false, reason: 'missing_guild_permissions', missing: [P.ManageChannels] });
      expect(board.sent).toEqual([]);
      expect(store.saves).toBe(0);
    });

    it('lists every permission it cannot grant when it has to create the board', async () => {
      const { guild, service } = setup();
      guild.botPermissionBits = ALL & ~P.AddReactions & ~P.EmbedLinks;

      expect(await service.run(guild, {})).toEqual({
        ok: false,
        reason: 'missing_guild_permissions',
        missing: [P.AddReactions, P.EmbedLinks],
      });
      expect(guild.created).toEqual([]);
    });

    it('only needs Manage Channels when the board channel already exists', async () => {
      const { guild, service } = setup();
      guild.botPermissionBits = P.ManageChannels | BOARD_BOT_ALLOW.reduce((a, f) => a | f, 0n);
      guild.addChannel(new FakeChannel('b1', 'mon-tableau', LOCKED));
      guild.addChannel(new FakeChannel('l1', 'mes-logs'));

      expectOk(await service.run(guild, { boardChannelId: 'b1', logsChannelId: 'l1' }));
    });
  });
});

describe('formatSetupReply', () => {
  it('summarises a successful setup in French', () => {
    const text = formatSetupReply({
      ok: true,
      board: { channelId: 'b1', created: true },
      logs: { channelId: 'l1', created: false },
      boardMessage: 'published',
      boardLockGaps: [],
      logsMissing: [],
    });
    expect(text).toBe(
      [
        '✅ Configuration enregistrée.',
        '• Tableau : <#b1> (créé)',
        '• Logs : <#l1> (existant)',
        'Le tableau est publié.',
      ].join('\n'),
    );
  });

  it('lists what the admin must fix by hand', () => {
    const text = formatSetupReply({
      ok: true,
      board: { channelId: 'b1', created: false },
      logs: { channelId: 'l1', created: false },
      boardMessage: 'edited',
      boardLockGaps: [P.SendMessages, P.AddReactions],
      logsMissing: [P.SendMessages],
    });
    expect(text).toContain('Le tableau est mis à jour.');
    expect(text).toContain(
      '⚠️ <#b1> n’est pas verrouillé : dans les permissions du salon, refuse à @everyone « Envoyer des messages », « Ajouter des réactions ».',
    );
    expect(text).toContain('⚠️ Je ne peux pas écrire dans <#l1> : il me manque « Envoyer des messages ».');
  });

  it.each<[SetupOutcome, string]>([
    [
      { ok: false, reason: 'missing_guild_permissions', missing: [P.ManageChannels] },
      '❌ Il me manque sur le serveur : « Gérer les salons ». Ajoute ces permissions à mon rôle puis relance `/setup`.',
    ],
    [{ ok: false, reason: 'channel_not_found', option: 'tableau' }, '❌ Je ne trouve pas le salon choisi pour le tableau, ou je ne peux pas le voir.'],
    [{ ok: false, reason: 'channel_not_found', option: 'logs' }, '❌ Je ne trouve pas le salon choisi pour les logs, ou je ne peux pas le voir.'],
    [{ ok: false, reason: 'same_channel' }, '❌ Le tableau et les logs doivent être deux salons différents.'],
    [
      { ok: false, reason: 'board_unusable', channelId: 'b1', missing: [P.EmbedLinks] },
      '❌ Je ne peux pas publier le tableau dans <#b1> : il me manque « Intégrer des liens ».',
    ],
  ])('explains failure %#', (outcome, expected) => {
    expect(formatSetupReply(outcome)).toBe(expected);
  });
});
