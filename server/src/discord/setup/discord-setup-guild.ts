import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type MessageEditOptions,
  type TextChannel,
} from 'discord.js';
import type { BoardMessagePayload } from '../render/board';
import type { OverwriteSpec } from './board-permissions';
import type { SetupGuild, SetupTextChannel } from './setup-ports';

/** discord.js implementation of the /setup ports. */
export async function createSetupGuild(guild: Guild): Promise<SetupGuild> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const everyoneRoleId = guild.roles.everyone.id;
  const wrap = (channel: TextChannel) => wrapChannel(channel, me, everyoneRoleId);

  return {
    id: guild.id,
    everyoneRoleId,
    botUserId: me.id,
    botPermissions: () =>
      me.permissions.has(PermissionFlagsBits.Administrator) ? PermissionsBitField.All : me.permissions.bitfield,

    async fetchTextChannel(channelId) {
      let channel;
      try {
        channel = await guild.channels.fetch(channelId);
      } catch (error) {
        if (isApiError(error, RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingAccess)) return null;
        throw error;
      }
      if (channel?.type !== ChannelType.GuildText) return null;
      if (!channel.permissionsFor(me).has(PermissionFlagsBits.ViewChannel)) return null;
      return wrap(channel);
    },

    findTextChannelByName(name) {
      const channel = guild.channels.cache.find(
        (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name,
      );
      return Promise.resolve(channel ? wrap(channel) : null);
    },

    async createTextChannel(name, overwrites: OverwriteSpec[]) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
      });
      return wrap(channel);
    },
  };
}

function wrapChannel(channel: TextChannel, me: GuildMember, everyoneRoleId: string): SetupTextChannel {
  return {
    id: channel.id,
    everyoneDeny: () => channel.permissionOverwrites.cache.get(everyoneRoleId)?.deny.bitfield ?? 0n,
    botPermissions: () => channel.permissionsFor(me).bitfield,

    async send(payload) {
      return (await channel.send(toMessageOptions(payload))).id;
    },

    async editMessage(messageId, payload) {
      try {
        await channel.messages.edit(messageId, toMessageOptions(payload));
        return true;
      } catch (error) {
        if (isApiError(error, RESTJSONErrorCodes.UnknownMessage)) return false;
        throw error;
      }
    },

    async deleteMessage(messageId) {
      try {
        await channel.messages.delete(messageId);
      } catch (error) {
        if (!isApiError(error, RESTJSONErrorCodes.UnknownMessage)) throw error;
      }
    },
  };
}

/** The render functions produce raw API payloads; discord.js wants camelCase mention options. */
function toMessageOptions(payload: BoardMessagePayload): MessageCreateOptions & MessageEditOptions {
  return {
    flags: payload.flags,
    components: payload.components,
    allowedMentions: { parse: [] },
  };
}

function isApiError(error: unknown, ...codes: number[]): boolean {
  return error instanceof DiscordAPIError && typeof error.code === 'number' && codes.includes(error.code);
}
