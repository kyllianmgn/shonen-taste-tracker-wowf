import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import { renderBoard, type BoardInput, type BoardMessagePayload } from '../render/board';
import type { BoardRest, BoardStore } from './board-ports';

export interface BoardPublisherOptions {
  /** BOARD_MIN_EDIT_INTERVAL_SEC in milliseconds. */
  minEditIntervalMs: number;
  /** Milliseconds since the epoch. */
  now: () => number;
}

interface GuildState {
  dirty: boolean;
  /** Last time Discord was called for this board (successfully or not). */
  lastEditAt?: number;
  /** Hash of the last render sent, and the message ids it went to. */
  hash?: string;
  messageIds?: string[];
  /** /admin rafraichir: delete every board message and post the board again on the next redraw. */
  recreate?: boolean;
}

/** Errors after which the board cannot work until an admin acts: the board is turned off. */
const DISABLING_ERRORS = new Set<number>([RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.MissingPermissions]);
const EPOCH = new Date(0);

/**
 * Board publication (docs/02 « Salon tableau et salon logs » → Debounce, Reprise).
 *
 * Changes mark a guild « to redraw »; `tick()` (every 5 s, see jobs/board-redraw.job.ts) redraws the
 * marked guilds whose last edit is at least `minEditIntervalMs` old. A render identical to the
 * previous one sends nothing. The board messages are edited in place, missing ones created, extra
 * ones deleted, and board_message_ids saved in display order.
 *
 * State lives in memory: after a restart every board is redrawn once (`markAllDirty`).
 * Rate limits (429) are handled by discord.js's REST queue.
 */
export class BoardPublisher {
  private readonly logger = new Logger(BoardPublisher.name);
  private readonly guilds = new Map<string, GuildState>();
  private allDirty = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: BoardStore,
    private readonly rest: BoardRest,
    private readonly options: BoardPublisherOptions,
  ) {}

  markDirty(guildId: string): void {
    this.state(guildId).dirty = true;
  }

  /** Marks every guild where this player is shown. */
  async markPlayerDirty(discordUserId: string): Promise<void> {
    for (const guildId of await this.store.guildIdsOfPlayer(discordUserId)) this.markDirty(guildId);
  }

  /** Every board is redrawn on the next tick (service startup). */
  markAllDirty(): void {
    this.allDirty = true;
  }

  /** The board messages changed outside the publisher (/setup): forget the last render and redraw. */
  invalidate(guildId: string): void {
    const state = this.state(guildId);
    state.hash = undefined;
    state.messageIds = undefined;
    state.dirty = true;
  }

  /**
   * /admin rafraichir: on the next allowed redraw, the board messages are deleted and the board is
   * posted again as new messages, even if the render did not change. The debounce still applies.
   */
  republish(guildId: string): void {
    const state = this.state(guildId);
    state.recreate = true;
    state.dirty = true;
  }

  /** One pass of the job. Never throws; a tick still running makes this call wait for it instead. */
  tick(): Promise<void> {
    this.running ??= this.runTick().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runTick(): Promise<void> {
    try {
      if (this.allDirty) {
        this.allDirty = false;
        for (const guildId of await this.store.listBoardGuildIds()) this.markDirty(guildId);
      }
      const now = this.options.now();
      for (const [guildId, state] of this.guilds) {
        if (!state.dirty) continue;
        if (state.lastEditAt !== undefined && now - state.lastEditAt < this.options.minEditIntervalMs) continue;
        state.dirty = false;
        await this.redraw(guildId, state);
      }
    } catch (error) {
      this.logger.error(`Board tick failed: ${describe(error)}`);
    }
  }

  private async redraw(guildId: string, state: GuildState): Promise<void> {
    const now = this.options.now();
    const board = await this.store.load(guildId, new Date(now));
    if (!board) {
      this.guilds.delete(guildId);
      return;
    }

    const recreate = state.recreate === true;
    state.recreate = false;
    const hash = renderHash(board.input);
    if (!recreate && hash === state.hash && sameIds(state.messageIds, board.boardMessageIds)) return;

    state.lastEditAt = now;
    const live = [...board.boardMessageIds];
    try {
      if (recreate) await this.deleteFrom(board.boardChannelId, live, 0);
      await this.sync(board.boardChannelId, live, renderBoard(board.input));
      state.hash = hash;
      state.messageIds = [...live];
    } catch (error) {
      if (isApiError(error, DISABLING_ERRORS)) {
        await this.disable(guildId, board.boardChannelId, board.logsChannelId, (error as DiscordAPIError).code as RESTJSONErrorCodes);
        return;
      }
      state.dirty = true;
      state.recreate = recreate;
      this.logger.warn(`Board redraw of guild ${guildId} failed, retrying later: ${describe(error)}`);
    } finally {
      if (!sameIds(live, board.boardMessageIds) && this.guilds.has(guildId)) {
        await this.store.saveMessageIds(guildId, live);
      }
    }
  }

  /**
   * Makes the channel show `payloads`, keeping `live` (the message ids, in order) up to date as it
   * goes so a failure halfway still saves what exists. A message deleted by hand (10008) is
   * republished together with the ones after it, so the order stays right.
   */
  private async sync(channelId: string, live: string[], payloads: BoardMessagePayload[]): Promise<void> {
    let kept = 0;
    while (kept < payloads.length && kept < live.length) {
      if (!(await this.edit(channelId, live[kept], payloads[kept]))) break;
      kept++;
    }
    await this.deleteFrom(channelId, live, kept);
    for (const payload of payloads.slice(kept)) {
      const message = (await this.rest.post(Routes.channelMessages(channelId), { body: payload })) as { id: string };
      live.push(message.id);
    }
  }

  /** Deletes the messages of `live` after the first `keep`, from the last one, keeping `live` up to date. */
  private async deleteFrom(channelId: string, live: string[], keep: number): Promise<void> {
    while (live.length > keep) {
      await this.delete(channelId, live[live.length - 1]);
      live.pop();
    }
  }

  /** false when the message no longer exists. */
  private async edit(channelId: string, messageId: string, payload: BoardMessagePayload): Promise<boolean> {
    try {
      await this.rest.patch(Routes.channelMessage(channelId, messageId), { body: payload });
      return true;
    } catch (error) {
      if (isApiError(error, new Set([RESTJSONErrorCodes.UnknownMessage]))) return false;
      throw error;
    }
  }

  private async delete(channelId: string, messageId: string): Promise<void> {
    try {
      await this.rest.delete(Routes.channelMessage(channelId, messageId));
    } catch (error) {
      if (!isApiError(error, new Set([RESTJSONErrorCodes.UnknownMessage]))) throw error;
    }
  }

  private async disable(
    guildId: string,
    boardChannelId: string,
    logsChannelId: string | null,
    code: RESTJSONErrorCodes,
  ): Promise<void> {
    this.guilds.delete(guildId);
    await this.store.disableBoard(guildId);
    this.logger.warn(`Board of guild ${guildId} disabled after Discord error ${code}`);
    if (!logsChannelId) return;
    try {
      await this.rest.post(Routes.channelMessages(logsChannelId), {
        body: { content: boardDisabledNotice(boardChannelId, code), allowed_mentions: { parse: [] } },
      });
    } catch (error) {
      this.logger.warn(`Could not warn guild ${guildId} in its logs channel: ${describe(error)}`);
    }
  }

  private state(guildId: string): GuildState {
    let state = this.guilds.get(guildId);
    if (!state) {
      state = { dirty: false };
      this.guilds.set(guildId, state);
    }
    return state;
  }
}

/** Message posted in the logs channel when the board is turned off (French, user-facing). */
export function boardDisabledNotice(boardChannelId: string, code: RESTJSONErrorCodes): string {
  if (code === RESTJSONErrorCodes.UnknownChannel) {
    return `⚠️ Le salon du tableau <#${boardChannelId}> est introuvable : le tableau est désactivé. Relance \`/setup\` pour le réactiver.`;
  }
  return `⚠️ Il me manque des permissions pour mettre à jour le tableau dans <#${boardChannelId}> : le tableau est désactivé. Corrige mes permissions puis relance \`/setup\`.`;
}

/**
 * Hash of the content, rendered at a fixed time: the « Mis à jour » timestamp changes on every
 * render but is relative on the client, so it alone never justifies an edit.
 */
function renderHash(input: BoardInput): string {
  return createHash('sha256').update(JSON.stringify(renderBoard({ ...input, now: EPOCH }))).digest('hex');
}

function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);
}

function isApiError(error: unknown, codes: ReadonlySet<number>): boolean {
  return error instanceof DiscordAPIError && typeof error.code === 'number' && codes.has(error.code);
}

/** Code and message only: never the request body. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' || typeof code === 'string' ? `${code} ${error.message}` : error.message;
}
