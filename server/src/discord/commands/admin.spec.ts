import { MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { CharacterService } from '../../core/characters/character.service';
import { ADMIN_MSG, adminAddReply, suspectsReply, type SuspectItem } from '../admin/admin-replies';
import { GuildSettingsService } from '../admin/guild-settings.service';
import { SuspectsQueryService } from '../admin/suspects-query.service';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import type { CommandContext, CommandHandler } from '../registry/command-handler';
import { handlers } from './admin';

const GUILD = '600000000000000001';
const MEMBER = '300000000000000002';
const NOW = new Date('2026-11-07T10:00:00Z');
const handler = (key: string) => handlers.find((h) => h.key === key)!;

interface Opts {
  admin?: boolean;
  inGuild?: boolean;
  strings?: Record<string, string>;
  member?: { id: string; bot: boolean };
}

function interaction(opts: Opts = {}) {
  const { admin = true, inGuild = true, strings = {}, member = { id: MEMBER, bot: false } } = opts;
  return {
    guildId: GUILD,
    inCachedGuild: () => inGuild,
    memberPermissions: new PermissionsBitField(admin ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.SendMessages),
    options: {
      getString: (name: string) => strings[name] ?? null,
      getUser: () => member,
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(overrides: { add?: jest.Mock; boardChannelId?: string | null; list?: jest.Mock } = {}) {
  const publisher = { republish: jest.fn(), markPlayerDirty: jest.fn().mockResolvedValue(undefined) };
  const add = overrides.add ?? jest.fn();
  const list = overrides.list ?? jest.fn().mockResolvedValue([]);
  const get = jest.fn().mockResolvedValue({
    levelAnnounceStep: 1,
    logDeaths: false,
    boardSort: 'level',
    boardChannelId: overrides.boardChannelId === undefined ? 'board' : overrides.boardChannelId,
  });
  const providers = new Map<unknown, unknown>([
    [CharacterService, { add }],
    [GuildSettingsService, { get }],
    [SuspectsQueryService, { list }],
    [BoardPublisher, publisher],
  ]);
  const ctx: CommandContext = { get: <T>(token: unknown) => providers.get(token) as T };
  return { ctx, publisher, add, list };
}

const execute = (key: string, i: ReturnType<typeof interaction>, ctx: CommandContext) =>
  handler(key).execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);

const KEYS = ['admin perso', 'admin rafraichir', 'admin suspects'];

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('/admin', () => {
  it('declares the three subcommands', () => {
    expect(handlers.map((h) => h.key).sort()).toEqual(KEYS);
  });

  it.each(KEYS)('%s refuses outside a server', async (key) => {
    const i = interaction({ inGuild: false });
    await execute(key, i, context().ctx);
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  it.each(KEYS)('%s refuses a member without Manage Server and does nothing', async (key) => {
    const { ctx, publisher, add, list } = context();
    const i = interaction({ admin: false, strings: { prenom: 'Davina', nom: 'Asaria' } });

    await execute(key, i, ctx);

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.manageGuildRequired, flags: MessageFlags.Ephemeral });
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(publisher.republish).not.toHaveBeenCalled();
  });

  describe('perso', () => {
    it('adds the character for the chosen member in this server, like /perso ajouter', async () => {
      const result = { status: 'added', character: { id: 1n, region: 'us', firstName: 'Davina', surname: 'Asaria' }, role: 'alt', created: true } as const;
      const { ctx, add, publisher } = context({ add: jest.fn().mockResolvedValue(result) });
      const i = interaction({ strings: { prenom: 'davina', nom: 'asaria', region: 'us', role: 'alt' } });

      await execute('admin perso', i, ctx);

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(add).toHaveBeenCalledWith({
        ownerId: MEMBER,
        guildId: GUILD,
        region: 'us',
        firstName: 'davina',
        surname: 'asaria',
        role: 'alt',
      });
      expect(publisher.markPlayerDirty).toHaveBeenCalledWith(MEMBER);
      expect(i.editReply).toHaveBeenCalledWith({ content: adminAddReply(MEMBER, result), allowedMentions: { parse: [] } });
    });

    it('defaults to EU and the first free role', async () => {
      const { ctx, add } = context({ add: jest.fn().mockResolvedValue({ status: 'invalid_name' }) });

      await execute('admin perso', interaction({ strings: { prenom: 'Davina', nom: 'Asaria' } }), ctx);

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu', role: undefined }));
    });

    it('refuses a bot as owner', async () => {
      const { ctx, add } = context();
      const i = interaction({ strings: { prenom: 'Davina', nom: 'Asaria' }, member: { id: '9', bot: true } });

      await execute('admin perso', i, ctx);

      expect(add).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: ADMIN_MSG.botMember });
    });
  });

  describe('rafraichir', () => {
    it('has the board deleted and republished', async () => {
      const { ctx, publisher } = context();
      const i = interaction();

      await execute('admin rafraichir', i, ctx);

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(publisher.republish).toHaveBeenCalledWith(GUILD);
      expect(i.editReply).toHaveBeenCalledWith({ content: ADMIN_MSG.refreshQueued });
    });

    it('points to /setup when the server has no board', async () => {
      const { ctx, publisher } = context({ boardChannelId: null });
      const i = interaction();

      await execute('admin rafraichir', i, ctx);

      expect(publisher.republish).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: ADMIN_MSG.noBoard });
    });
  });

  describe('suspects', () => {
    it('lists the flagged data of this server’s members over the last 7 days', async () => {
      const items: SuspectItem[] = [
        {
          kind: 'snapshot',
          at: NOW,
          character: { region: 'eu', firstName: 'Davina', surname: 'Asaria' },
          ownerId: MEMBER,
          level: 23,
          flags: ['suspect_level_jump'],
        },
      ];
      const { ctx, list } = context({ list: jest.fn().mockResolvedValue(items) });
      const i = interaction();

      await execute('admin suspects', i, ctx);

      expect(list).toHaveBeenCalledWith(GUILD, new Date(NOW.getTime() - 7 * 24 * 3600 * 1000));
      expect(i.editReply).toHaveBeenCalledWith({ content: suspectsReply(items), allowedMentions: { parse: [] } });
    });
  });
});
