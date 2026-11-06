import type { BoardPlayer, BoardSort } from '../../render/board';
import type { BoardStore, LoadedBoard } from '../board-ports';

export interface FakeGuild {
  boardChannelId: string | null;
  boardMessageIds: string[];
  logsChannelId: string | null;
  boardSort: BoardSort;
  players: BoardPlayer[];
}

/** In-memory guild_config + members, enough for the board publisher. */
export class FakeBoardStore implements BoardStore {
  readonly guilds = new Map<string, FakeGuild>();
  loads = 0;

  addGuild(guildId: string, guild: Partial<FakeGuild> = {}): FakeGuild {
    const full: FakeGuild = {
      boardChannelId: `board-${guildId}`,
      boardMessageIds: [],
      logsChannelId: `logs-${guildId}`,
      boardSort: 'level',
      players: [],
      ...guild,
    };
    this.guilds.set(guildId, full);
    return full;
  }

  guild(guildId: string): FakeGuild {
    const guild = this.guilds.get(guildId);
    if (!guild) throw new Error(`unknown guild ${guildId}`);
    return guild;
  }

  listBoardGuildIds(): Promise<string[]> {
    return Promise.resolve([...this.guilds].filter(([, g]) => g.boardChannelId !== null).map(([id]) => id));
  }

  guildIdsOfPlayer(discordUserId: string): Promise<string[]> {
    return Promise.resolve(
      [...this.guilds]
        .filter(([, g]) => g.boardChannelId !== null && g.players.some((p) => p.discordUserId === discordUserId))
        .map(([id]) => id),
    );
  }

  load(guildId: string, now: Date): Promise<LoadedBoard | null> {
    this.loads++;
    const guild = this.guilds.get(guildId);
    if (!guild?.boardChannelId) return Promise.resolve(null);
    return Promise.resolve({
      boardChannelId: guild.boardChannelId,
      boardMessageIds: [...guild.boardMessageIds],
      logsChannelId: guild.logsChannelId,
      input: { guild: { boardSort: guild.boardSort }, players: structuredClone(guild.players), now },
    });
  }

  saveMessageIds(guildId: string, messageIds: string[]): Promise<void> {
    this.guild(guildId).boardMessageIds = [...messageIds];
    return Promise.resolve();
  }

  disableBoard(guildId: string): Promise<void> {
    const guild = this.guild(guildId);
    guild.boardChannelId = null;
    guild.boardMessageIds = [];
    return Promise.resolve();
  }
}
