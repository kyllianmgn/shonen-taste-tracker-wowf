import { PermissionsBitField } from 'discord.js';
import type { BoardMessagePayload } from '../../render/board';
import type { OverwriteSpec } from '../board-permissions';
import type { GuildChannelsConfig, GuildConfigStore, SetupGuild, SetupTextChannel } from '../setup-ports';

/** In-memory guild and channels for /setup tests. Ids are short fake snowflakes. */

export class FakeChannel implements SetupTextChannel {
  readonly messages = new Map<string, BoardMessagePayload>();
  readonly sent: string[] = [];
  readonly edited: string[] = [];
  readonly deleted: string[] = [];

  constructor(
    readonly id: string,
    readonly name: string,
    public everyoneDenyBits = 0n,
    public botPermissionBits: bigint = PermissionsBitField.All,
    readonly overwrites: OverwriteSpec[] = [],
    private readonly nextMessageId: () => string = () => `${id}-m${this.sent.length + 1}`,
  ) {}

  everyoneDeny(): bigint {
    return this.everyoneDenyBits;
  }

  botPermissions(): bigint {
    return this.botPermissionBits;
  }

  send(payload: BoardMessagePayload): Promise<string> {
    const messageId = this.nextMessageId();
    this.sent.push(messageId);
    this.messages.set(messageId, payload);
    return Promise.resolve(messageId);
  }

  editMessage(messageId: string, payload: BoardMessagePayload): Promise<boolean> {
    if (!this.messages.has(messageId)) return Promise.resolve(false);
    this.edited.push(messageId);
    this.messages.set(messageId, payload);
    return Promise.resolve(true);
  }

  deleteMessage(messageId: string): Promise<void> {
    this.deleted.push(messageId);
    this.messages.delete(messageId);
    return Promise.resolve();
  }
}

export class FakeGuild implements SetupGuild {
  readonly channels = new Map<string, FakeChannel>();
  readonly created: FakeChannel[] = [];
  /** Channels that exist but are hidden from the bot. */
  readonly hidden = new Set<string>();
  private nextId = 1;

  constructor(
    readonly id = 'g1',
    public botPermissionBits: bigint = PermissionsBitField.All,
    readonly everyoneRoleId = 'g1',
    readonly botUserId = 'bot',
  ) {}

  botPermissions(): bigint {
    return this.botPermissionBits;
  }

  addChannel(channel: FakeChannel): FakeChannel {
    this.channels.set(channel.id, channel);
    return channel;
  }

  fetchTextChannel(channelId: string): Promise<SetupTextChannel | null> {
    if (this.hidden.has(channelId)) return Promise.resolve(null);
    return Promise.resolve(this.channels.get(channelId) ?? null);
  }

  findTextChannelByName(name: string): Promise<SetupTextChannel | null> {
    const found = [...this.channels.values()].find((c) => c.name === name && !this.hidden.has(c.id));
    return Promise.resolve(found ?? null);
  }

  createTextChannel(name: string, overwrites: OverwriteSpec[]): Promise<SetupTextChannel> {
    const everyone = overwrites.find((o) => o.id === this.everyoneRoleId);
    const channel = new FakeChannel(`c${this.nextId++}`, name, everyone?.deny ?? 0n, PermissionsBitField.All, overwrites);
    this.created.push(channel);
    return Promise.resolve(this.addChannel(channel));
  }
}

export class FakeGuildConfigStore implements GuildConfigStore {
  readonly rows = new Map<string, GuildChannelsConfig>();
  saves = 0;

  find(guildId: string): Promise<GuildChannelsConfig | null> {
    const row = this.rows.get(guildId);
    return Promise.resolve(row ? { ...row, boardMessageIds: [...row.boardMessageIds] } : null);
  }

  saveChannels(guildId: string, channels: GuildChannelsConfig): Promise<void> {
    this.saves++;
    this.rows.set(guildId, { ...channels, boardMessageIds: [...channels.boardMessageIds] });
    return Promise.resolve();
  }
}
