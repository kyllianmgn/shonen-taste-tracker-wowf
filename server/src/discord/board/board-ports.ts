import type { BoardInput } from '../render/board';

/**
 * The slices of Discord and of the database that the board publisher needs. The adapters are
 * discord.js's REST client and prisma-board.store.ts; tests use in-memory fakes (./testing).
 */

export const BOARD_STORE = Symbol('BOARD_STORE');

/** Subset of discord.js's `REST` (client.rest): raw API routes and bodies, errors are `DiscordAPIError`. */
export interface BoardRest {
  post(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
  patch(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
  delete(route: `/${string}`): Promise<unknown>;
}

/** Everything one board redraw needs, read in one go. */
export interface LoadedBoard {
  boardChannelId: string;
  /** In display order. */
  boardMessageIds: string[];
  logsChannelId: string | null;
  input: BoardInput;
}

export interface BoardStore {
  /** Guilds with a board channel configured. */
  listBoardGuildIds(): Promise<string[]>;
  /** Guilds with a board channel where this player has a membership. */
  guildIdsOfPlayer(discordUserId: string): Promise<string[]>;
  /** null when the guild is unknown or its board is disabled (no board channel). */
  load(guildId: string, now: Date): Promise<LoadedBoard | null>;
  saveMessageIds(guildId: string, messageIds: string[]): Promise<void>;
  /** Clears board_channel_id and board_message_ids; /setup turns the board back on. */
  disableBoard(guildId: string): Promise<void>;
}
