import { MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { configReply, type GuildSettings, type GuildSettingsPatch } from '../admin/admin-replies';
import { GuildSettingsService } from '../admin/guild-settings.service';
import { BoardPublisher } from '../board/board-publisher';
import { FakeBoardRest } from '../board/testing/fake-board-rest';
import { FakeBoardStore } from '../board/testing/fake-board-store';
import { MSG } from '../messages';
import type { BoardPlayer, BoardSort } from '../render/board';
import type { CommandContext, CommandHandler } from '../registry/command-handler';
import { handlers } from './config';

const GUILD = '600000000000000001';
const handler = handlers.find((h) => h.key === 'config')!;

type Options = { annonce_niveau?: number; morts?: boolean; tri?: string };

function interaction(options: Options = {}, opts: { admin?: boolean; inGuild?: boolean } = {}) {
  const { admin = true, inGuild = true } = opts;
  return {
    guildId: GUILD,
    inCachedGuild: () => inGuild,
    memberPermissions: new PermissionsBitField(admin ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.SendMessages),
    options: {
      getInteger: (name: string) => (name === 'annonce_niveau' ? (options.annonce_niveau ?? null) : null),
      getBoolean: (name: string) => (name === 'morts' ? (options.morts ?? null) : null),
      getString: (name: string) => (name === 'tri' ? (options.tri ?? null) : null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const execute = (i: ReturnType<typeof interaction>, ctx: CommandContext) =>
  handler.execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);

const DEFAULTS: GuildSettings = { levelAnnounceStep: 1, logDeaths: false, boardSort: 'level', boardChannelId: 'board' };

function player(id: string, firstName: string, level: number, playedTotal: number): BoardPlayer {
  return {
    discordUserId: id,
    mode: 'app',
    privacy: { hideZone: false, hidePresence: false },
    presence: { online: false, lastSeenAt: null },
    main: { firstName, surname: 'Test', classFile: 'MAGE', snapshot: { level, xp: 0, xpMax: 100, playedTotal, zone: null } },
    alt: null,
  };
}

/**
 * A settings service backed by the fake board store, and the real board publisher drawing into a
 * fake Discord: what /config writes is what the next board render reads.
 */
function harness() {
  const store = new FakeBoardStore();
  const guild = store.addGuild(GUILD, {
    // Level order: Zora, Anya, Milo. Played order: Milo, Anya, Zora. Name order: Anya, Milo, Zora.
    players: [player('1', 'Anya', 20, 3_000), player('2', 'Milo', 10, 9_000), player('3', 'Zora', 30, 1_000)],
  });
  let settings: GuildSettings = { ...DEFAULTS };
  const settingsService = {
    get: jest.fn(() => Promise.resolve(settings)),
    update: jest.fn((_guildId: string, patch: GuildSettingsPatch) => {
      settings = { ...settings, ...patch };
      guild.boardSort = settings.boardSort;
      return Promise.resolve(settings);
    }),
  };
  let now = 0;
  const rest = new FakeBoardRest();
  const publisher = new BoardPublisher(store, rest, { minEditIntervalMs: 15_000, now: () => now });
  const providers = new Map<unknown, unknown>([
    [GuildSettingsService, settingsService],
    [BoardPublisher, publisher],
  ]);
  const ctx: CommandContext = { get: <T>(token: unknown) => providers.get(token) as T };
  const boardText = () =>
    rest
      .messagesOf(guild.boardChannelId!)
      .map((m) => JSON.stringify(m.body))
      .join('');
  const order = () => ['Anya', 'Milo', 'Zora'].sort((a, b) => boardText().indexOf(a) - boardText().indexOf(b));
  const advance = (ms: number) => (now += ms);
  return { ctx, settingsService, publisher, rest, order, advance };
}

describe('/config', () => {
  it('refuses outside a server', async () => {
    const i = interaction({}, { inGuild: false });
    await execute(i, harness().ctx);
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  it('refuses a member without Manage Server, even if the command was made visible to them', async () => {
    const { ctx, settingsService } = harness();
    const i = interaction({ tri: 'name' }, { admin: false });

    await execute(i, ctx);

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.manageGuildRequired, flags: MessageFlags.Ephemeral });
    expect(settingsService.update).not.toHaveBeenCalled();
  });

  it('without options, shows the current settings and changes nothing', async () => {
    const { ctx, settingsService } = harness();
    const i = interaction();

    await execute(i, ctx);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(settingsService.update).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ content: configReply(DEFAULTS, false) });
  });

  it('passes only the given options and answers with the saved settings', async () => {
    const { ctx, settingsService } = harness();
    const i = interaction({ annonce_niveau: 5, morts: true });

    await execute(i, ctx);

    expect(settingsService.update).toHaveBeenCalledWith(GUILD, { levelAnnounceStep: 5, logDeaths: true });
    expect(i.editReply).toHaveBeenCalledWith({
      content: configReply({ ...DEFAULTS, levelAnnounceStep: 5, logDeaths: true }, true),
    });
  });

  it.each<[Options, string]>([
    [{ annonce_niveau: 10 }, 'Annonce des niveaux : tous les 10 niveaux'],
    [{ morts: true }, 'Morts dans les logs : oui'],
    [{ tri: 'played' }, 'Tri du tableau : temps joué'],
  ])('%o changes the rendered settings', async (options, line) => {
    const { ctx } = harness();
    const i = interaction(options);

    await execute(i, ctx);

    const [[{ content }]] = i.editReply.mock.calls as [[{ content: string }]];
    expect(content).toContain(line);
  });

  it.each<[BoardSort, string[]]>([
    ['played', ['Milo', 'Anya', 'Zora']],
    ['name', ['Anya', 'Milo', 'Zora']],
    ['level', ['Zora', 'Anya', 'Milo']],
  ])('tri:%s redraws the board in that order', async (tri, expected) => {
    const { ctx, publisher, order, advance } = harness();
    publisher.markDirty(GUILD);
    await publisher.tick(); // first board, sorted by level
    advance(15_000);

    await execute(interaction({ tri }), ctx);
    await publisher.tick();

    expect(order()).toEqual(expected);
  });
});
