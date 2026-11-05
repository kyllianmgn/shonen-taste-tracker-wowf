import type { BoardMessagePayload } from '../render/board';
import type { OverwriteSpec } from './board-permissions';

/**
 * The slice of Discord that /setup needs. The discord.js adapter is discord-setup-guild.ts;
 * tests use in-memory fakes.
 */

export interface SetupTextChannel {
  readonly id: string;
  /** Permissions denied to @everyone by this channel's own overwrite (0n without one). */
  everyoneDeny(): bigint;
  /** The bot's effective permissions in this channel (Administrator expanded to all). */
  botPermissions(): bigint;
  /** Posts a message and returns its id. */
  send(payload: BoardMessagePayload): Promise<string>;
  /** Edits one of the bot's messages; false when the message no longer exists. */
  editMessage(messageId: string, payload: BoardMessagePayload): Promise<boolean>;
  /** Deletes a message; a message that no longer exists is not an error. */
  deleteMessage(messageId: string): Promise<void>;
}

export interface SetupGuild {
  readonly id: string;
  readonly everyoneRoleId: string;
  readonly botUserId: string;
  /** The bot's server-level permissions (Administrator expanded to all). */
  botPermissions(): bigint;
  /** A text channel of this server, or null if it does not exist, is not text or is hidden from the bot. */
  fetchTextChannel(channelId: string): Promise<SetupTextChannel | null>;
  findTextChannelByName(name: string): Promise<SetupTextChannel | null>;
  createTextChannel(name: string, overwrites: OverwriteSpec[]): Promise<SetupTextChannel>;
}

export interface GuildChannelsConfig {
  boardChannelId: string | null;
  logsChannelId: string | null;
  boardMessageIds: string[];
}

/** guild_config rows, reduced to what /setup reads and writes. */
export interface GuildConfigStore {
  find(guildId: string): Promise<GuildChannelsConfig | null>;
  /** Creates the row with defaults, or updates these three columns only. */
  saveChannels(guildId: string, channels: GuildChannelsConfig): Promise<void>;
}
