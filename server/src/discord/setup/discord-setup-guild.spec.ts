import {
  ChannelType,
  Collection,
  DiscordAPIError,
  OverwriteType,
  PermissionFlagsBits as P,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type Guild,
} from 'discord.js';
import { provisionalBoard } from './provisional-board';
import { createSetupGuild } from './discord-setup-guild';

const apiError = (code: number) =>
  new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', '/x', {});

/** discord.js-shaped doubles: only the members the adapter reads. */
function fakeChannel(id: string, opts: { type?: ChannelType; name?: string; everyoneDeny?: bigint; bot?: bigint } = {}) {
  return {
    id,
    name: opts.name ?? id,
    type: opts.type ?? ChannelType.GuildText,
    permissionOverwrites: {
      cache: new Map(
        opts.everyoneDeny === undefined ? [] : [['g1', { deny: new PermissionsBitField(opts.everyoneDeny) }]],
      ),
    },
    permissionsFor: jest.fn(() => new PermissionsBitField(opts.bot ?? PermissionsBitField.All)),
    send: jest.fn().mockResolvedValue({ id: 'm1' }),
    messages: {
      edit: jest.fn().mockResolvedValue({ id: 'm1' }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function fakeGuild(channels: ReturnType<typeof fakeChannel>[], botPermissions = P.ManageChannels) {
  const me = { id: 'bot', permissions: new PermissionsBitField(botPermissions) };
  const cache = new Collection(channels.map((c) => [c.id, c]));
  return {
    id: 'g1',
    roles: { everyone: { id: 'g1' } },
    members: { me, fetchMe: jest.fn().mockResolvedValue(me) },
    channels: {
      cache,
      fetch: jest.fn((id: string) => {
        const channel = cache.get(id);
        return channel ? Promise.resolve(channel) : Promise.reject(apiError(RESTJSONErrorCodes.UnknownChannel));
      }),
      create: jest.fn((o: { name: string }) => Promise.resolve(fakeChannel('new', { name: o.name }))),
    },
  };
}

const adapt = (guild: ReturnType<typeof fakeGuild>) => createSetupGuild(guild as unknown as Guild);

describe('createSetupGuild (discord.js adapter)', () => {
  it('exposes ids and expands Administrator to every permission', async () => {
    const plain = await adapt(fakeGuild([], P.ManageChannels));
    expect([plain.id, plain.everyoneRoleId, plain.botUserId]).toEqual(['g1', 'g1', 'bot']);
    expect(plain.botPermissions()).toBe(P.ManageChannels);

    const admin = await adapt(fakeGuild([], P.Administrator));
    expect(admin.botPermissions()).toBe(PermissionsBitField.All);
  });

  it('fetches the bot member when it is not cached', async () => {
    const guild = fakeGuild([]);
    const me = guild.members.me;
    (guild.members as { me: unknown }).me = null;

    const adapted = await adapt(guild);

    expect(guild.members.fetchMe).toHaveBeenCalled();
    expect(adapted.botUserId).toBe(me.id);
  });

  it('returns null for an unknown, non-text or hidden channel', async () => {
    const guild = fakeGuild([
      fakeChannel('voice', { type: ChannelType.GuildVoice }),
      fakeChannel('hidden', { bot: P.SendMessages }),
      fakeChannel('text'),
    ]);
    const adapted = await adapt(guild);

    await expect(adapted.fetchTextChannel('gone')).resolves.toBeNull();
    await expect(adapted.fetchTextChannel('voice')).resolves.toBeNull();
    await expect(adapted.fetchTextChannel('hidden')).resolves.toBeNull();
    await expect(adapted.fetchTextChannel('text')).resolves.toMatchObject({ id: 'text' });
  });

  it('propagates other fetch errors', async () => {
    const guild = fakeGuild([]);
    guild.channels.fetch.mockRejectedValue(apiError(RESTJSONErrorCodes.MissingPermissions));

    await expect((await adapt(guild)).fetchTextChannel('x')).rejects.toBeInstanceOf(DiscordAPIError);
  });

  it('finds a text channel by name in the cache', async () => {
    const adapted = await adapt(
      fakeGuild([fakeChannel('v', { name: 'tableau-forever', type: ChannelType.GuildVoice }), fakeChannel('t', { name: 'tableau-forever' })]),
    );

    await expect(adapted.findTextChannelByName('tableau-forever')).resolves.toMatchObject({ id: 't' });
    await expect(adapted.findTextChannelByName('absent')).resolves.toBeNull();
  });

  it('creates a text channel with the given overwrites', async () => {
    const guild = fakeGuild([]);
    const overwrites = [{ id: 'g1', type: OverwriteType.Role, allow: 0n, deny: P.SendMessages }];

    const created = await (await adapt(guild)).createTextChannel('tableau-forever', overwrites);

    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'tableau-forever',
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });
    expect(created.id).toBe('new');
  });

  it('reads the @everyone denies and the bot permissions of a channel', async () => {
    const adapted = await adapt(
      fakeGuild([fakeChannel('locked', { everyoneDeny: P.SendMessages, bot: P.ViewChannel }), fakeChannel('open')]),
    );

    const locked = (await adapted.fetchTextChannel('locked'))!;
    expect(locked.everyoneDeny()).toBe(P.SendMessages);
    expect(locked.botPermissions()).toBe(P.ViewChannel);
    expect((await adapted.fetchTextChannel('open'))!.everyoneDeny()).toBe(0n);
  });

  it('sends Components V2 payloads with mentions disabled', async () => {
    const raw = fakeChannel('t');
    const channel = (await (await adapt(fakeGuild([raw]))).fetchTextChannel('t'))!;
    const payload = provisionalBoard();

    await expect(channel.send(payload)).resolves.toBe('m1');
    expect(raw.send).toHaveBeenCalledWith({
      flags: payload.flags,
      components: payload.components,
      allowedMentions: { parse: [] },
    });
  });

  it('maps « Unknown Message » to false on edit and to a no-op on delete', async () => {
    const raw = fakeChannel('t');
    const channel = (await (await adapt(fakeGuild([raw]))).fetchTextChannel('t'))!;

    await expect(channel.editMessage('m1', provisionalBoard())).resolves.toBe(true);
    raw.messages.edit.mockRejectedValue(apiError(RESTJSONErrorCodes.UnknownMessage));
    await expect(channel.editMessage('m1', provisionalBoard())).resolves.toBe(false);

    raw.messages.delete.mockRejectedValue(apiError(RESTJSONErrorCodes.UnknownMessage));
    await expect(channel.deleteMessage('m1')).resolves.toBeUndefined();
    raw.messages.delete.mockRejectedValue(apiError(RESTJSONErrorCodes.MissingPermissions));
    await expect(channel.deleteMessage('m1')).rejects.toBeInstanceOf(DiscordAPIError);
  });
});
