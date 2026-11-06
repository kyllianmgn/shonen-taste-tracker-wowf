import { DiscordAPIError, MessageFlags, PermissionFlagsBits, PermissionsBitField, RESTJSONErrorCodes } from 'discord.js';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import type { CommandContext } from '../registry/command-handler';
import * as adapter from '../setup/discord-setup-guild';
import { SetupService, formatSetupReply, type SetupOutcome } from '../setup/setup.service';
import { FakeGuild } from '../setup/testing/fake-setup-guild';
import { handlers } from './setup';

const setupHandler = handlers.find((h) => h.key === 'setup')!;

const SUCCESS: SetupOutcome = {
  ok: true,
  board: { channelId: 'b1', created: true },
  logs: { channelId: 'l1', created: true },
  boardMessage: 'published',
  boardLockGaps: [],
  logsMissing: [],
};

function interaction(opts: { admin?: boolean; inGuild?: boolean; tableau?: string; logs?: string } = {}) {
  const { admin = true, inGuild = true } = opts;
  const channels: Record<string, { id: string } | null> = {
    tableau: opts.tableau ? { id: opts.tableau } : null,
    logs: opts.logs ? { id: opts.logs } : null,
  };
  return {
    guild: { id: 'g1' },
    inCachedGuild: () => inGuild,
    memberPermissions: new PermissionsBitField(admin ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.SendMessages),
    options: { getChannel: (name: string) => channels[name] ?? null },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const invalidate = jest.fn();

function context(run: jest.Mock) {
  const service = { run } as unknown as SetupService;
  const publisher = { invalidate } as unknown as BoardPublisher;
  const ctx: CommandContext = { get: <T>(token: unknown) => (token === BoardPublisher ? publisher : service) as T };
  return ctx;
}

const execute = (i: ReturnType<typeof interaction>, ctx: CommandContext) =>
  setupHandler.execute(i as unknown as Parameters<typeof setupHandler.execute>[0], ctx);

let fakeGuild: FakeGuild;
beforeEach(() => {
  fakeGuild = new FakeGuild();
  jest.spyOn(adapter, 'createSetupGuild').mockResolvedValue(fakeGuild);
});
afterEach(() => {
  jest.restoreAllMocks();
  invalidate.mockReset();
});

describe('/setup command', () => {
  it('defers ephemerally, runs the setup with the chosen channels and answers in French', async () => {
    const run = jest.fn().mockResolvedValue(SUCCESS);
    const i = interaction({ tableau: 'b1', logs: 'l1' });

    await execute(i, context(run));

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(run).toHaveBeenCalledWith(fakeGuild, { boardChannelId: 'b1', logsChannelId: 'l1' });
    expect(i.editReply).toHaveBeenCalledWith({ content: formatSetupReply(SUCCESS) });
  });

  it('asks for a redraw of the board, which /setup left provisional', async () => {
    await execute(interaction(), context(jest.fn().mockResolvedValue(SUCCESS)));

    expect(invalidate).toHaveBeenCalledWith('g1');
  });

  it('asks for no redraw when the setup failed', async () => {
    await execute(interaction(), context(jest.fn().mockResolvedValue({ ok: false, reason: 'same_channel' })));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('passes no channel when the options are omitted', async () => {
    const run = jest.fn().mockResolvedValue(SUCCESS);

    await execute(interaction(), context(run));

    expect(run).toHaveBeenCalledWith(fakeGuild, { boardChannelId: undefined, logsChannelId: undefined });
  });

  it('refuses a member without Manage Server, before touching anything', async () => {
    const run = jest.fn();
    const i = interaction({ admin: false });

    await execute(i, context(run));

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.manageGuildRequired, flags: MessageFlags.Ephemeral });
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses outside a server', async () => {
    const run = jest.fn();
    const i = interaction({ inGuild: false });

    await execute(i, context(run));

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    expect(run).not.toHaveBeenCalled();
  });

  it('explains a Discord « Missing Permissions » error instead of a generic failure', async () => {
    const denied = new DiscordAPIError(
      { code: RESTJSONErrorCodes.MissingPermissions, message: 'Missing Permissions' },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      'POST',
      '/guilds/g1/channels',
      {},
    );
    const i = interaction();

    await execute(i, context(jest.fn().mockRejectedValue(denied)));

    expect(i.editReply).toHaveBeenCalledWith({ content: MSG.missingPermissions });
  });

  it('lets other errors reach the registry', async () => {
    await expect(execute(interaction(), context(jest.fn().mockRejectedValue(new Error('db down'))))).rejects.toThrow(
      'db down',
    );
  });
});
