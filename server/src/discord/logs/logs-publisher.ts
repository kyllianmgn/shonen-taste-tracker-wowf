import { Logger } from '@nestjs/common';
import { DiscordAPIError, RESTJSONErrorCodes, Routes } from 'discord.js';
import type { CharacterTrackedEvent } from '../../core/characters/character.events';
import type { EventRecordedEvent } from '../../ingest/sync/sync.events';
import type { SessionEndedEvent, SessionStartedEvent } from '../../presence/presence.events';
import {
  LOG_MAX_MESSAGE_CHARS,
  renderBaseModeSessionEndLog,
  renderSessionEndLog,
  renderSessionStartLog,
  renderTrackedLog,
  type LogCharacter,
} from '../render/logs';
import { eventLevel, eventLogLine, isPublishableEvent } from './log-rules';
import type { LogTarget, LogsRest, LogsStore } from './logs-ports';

/** At most one message per logs channel this often (docs/02 « Logs »). */
export const LOG_SEND_INTERVAL_MS = 1_500;
/** A player's lines arriving less than this apart are grouped in one message. */
export const LOG_GROUP_WINDOW_MS = 10_000;
/** A message failing this many times (other than a permanent error) is dropped. */
const MAX_ATTEMPTS = 3;

/** Errors after which the channel cannot receive anything until an admin acts. */
const CHANNEL_ERRORS = new Set<number>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

/** Types that can post something; the others are not even looked at. */
const LOGGED_TYPES = new Set(['LEVEL_UP', 'DEATH', 'GUILD_CHANGE']);

export interface LogsPublisherOptions {
  /** Milliseconds since the epoch. */
  now: () => number;
}

interface Line {
  /** Ordering inside a message: the time of what happened. */
  at: number;
  text: string;
}

/** One future message: lines of one player in one channel. */
interface Group {
  ownerId: string;
  lines: Line[];
  length: number;
  /** When the last line arrived. */
  lastAt: number;
  /** Full: no more lines, sent as soon as the channel allows. */
  closed: boolean;
  attempts: number;
}

interface ChannelQueue {
  groups: Group[];
  lastSentAt?: number;
}

/**
 * Logs channel publication (docs/02 « Salon tableau et salon logs » → Logs).
 *
 * Listeners hand over game events, sessions and newly tracked characters; each becomes a line in
 * the logs channel of every guild where the player has a membership. Lines of one player wait
 * until 10 s pass without a new one, then leave as one message; each channel sends at most one
 * message every 1.5 s (`tick()`, see jobs/logs-send.job.ts).
 *
 * A game event is claimed in the database (published_at) before it is queued: it is never posted
 * twice, even across restarts or when the addon and Battle.net both record the same level. The
 * queue itself lives in memory: what is waiting at a crash is lost, `flush()` empties it on a clean
 * shutdown. Rate limits (429) are handled by discord.js's REST queue.
 */
export class LogsPublisher {
  private readonly logger = new Logger(LogsPublisher.name);
  private readonly channels = new Map<string, ChannelQueue>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: LogsStore,
    private readonly rest: LogsRest,
    private readonly options: LogsPublisherOptions,
  ) {}

  async onEventRecorded(event: EventRecordedEvent): Promise<void> {
    const now = this.options.now();
    if (!LOGGED_TYPES.has(event.type) || !isPublishableEvent(event, new Date(now))) return;
    const targets = await this.store.targetsOfPlayer(event.ownerId);
    if (!targets.length) return;
    const [character, privacy] = await Promise.all([this.store.characterOf(event.characterId), this.store.privacyOf(event.ownerId)]);
    if (!character || character.role === 'untracked') return;

    const lines = targets
      .map((target) => ({
        target,
        text: eventLogLine(event, { character, female: character.female, hideZone: privacy.hideZone, ...settings(target) }),
      }))
      .filter((l): l is { target: LogTarget; text: string } => l.text !== null);
    if (!lines.length) return;

    const level = event.type === 'LEVEL_UP' ? eventLevel(event.data) : null;
    const claim = { id: event.id, characterId: event.characterId, type: event.type, level };
    if (!(await this.store.claimEvent(claim, new Date(now)))) return;
    for (const { target, text } of lines) this.enqueue(target.logsChannelId, event.ownerId, { at: event.at.getTime(), text });
  }

  async onSessionStarted(event: SessionStartedEvent): Promise<void> {
    const privacy = await this.store.privacyOf(event.ownerId);
    if (privacy.hidePresence) return;
    const targets = await this.store.targetsOfPlayer(event.ownerId);
    if (!targets.length) return;
    const shown = await this.shownCharacter(event.characterId);
    const text = renderSessionStartLog({ discordUserId: event.ownerId, character: shown?.names ?? null, level: shown?.level ?? null });
    this.enqueueAll(targets, event.ownerId, { at: event.startedAt.getTime(), text });
  }

  async onSessionEnded(event: SessionEndedEvent): Promise<void> {
    if (event.quiet) return;
    const targets = await this.store.targetsOfPlayer(event.ownerId);
    if (!targets.length) return;
    const [privacy, shown] = await Promise.all([this.store.privacyOf(event.ownerId), this.shownCharacter(event.characterId)]);
    const character = shown?.names ?? null;
    // Base mode: deduced from the public profile, only the levels are known (S-20).
    const text =
      event.reason === 'bnet_logout'
        ? renderBaseModeSessionEndLog({ discordUserId: event.ownerId, character, recap: event.recap })
        : renderSessionEndLog({ discordUserId: event.ownerId, character, recap: event.recap, privacy });
    this.enqueueAll(targets, event.ownerId, { at: event.endedAt.getTime(), text });
  }

  async onCharacterTracked(event: CharacterTrackedEvent): Promise<void> {
    const targets = await this.store.targetsOfPlayer(event.ownerId);
    const text = renderTrackedLog({ discordUserId: event.ownerId, character: event, role: event.role });
    this.enqueueAll(targets, event.ownerId, { at: this.options.now(), text });
  }

  /** One pass of the job. Never throws; a pass still running makes this call wait for it instead. */
  tick(): Promise<void> {
    this.running ??= this.runTick(false).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Sends everything still waiting, ignoring the grouping window and the pace (shutdown). */
  async flush(): Promise<void> {
    await this.running;
    await this.runTick(true);
  }

  private async runTick(all: boolean): Promise<void> {
    for (const [channelId, queue] of this.channels) {
      try {
        do {
          const now = this.options.now();
          if (!all && queue.lastSentAt !== undefined && now - queue.lastSentAt < LOG_SEND_INTERVAL_MS) break;
          const group = queue.groups.find((g) => all || g.closed || now - g.lastAt >= LOG_GROUP_WINDOW_MS);
          if (!group) break;
          queue.lastSentAt = now;
          await this.send(channelId, queue, group);
        } while (all && queue.groups.length);
      } catch (error) {
        this.logger.error(`Logs tick failed for channel ${channelId}: ${describe(error)}`);
      }
      if (!queue.groups.length) this.channels.delete(channelId);
    }
  }

  private async send(channelId: string, queue: ChannelQueue, group: Group): Promise<void> {
    const content = [...group.lines]
      .sort((a, b) => a.at - b.at)
      .map((l) => l.text)
      .join('\n');
    try {
      await this.rest.post(Routes.channelMessages(channelId), { body: { content, allowed_mentions: { parse: [] } } });
      remove(queue.groups, group);
    } catch (error) {
      if (isApiError(error, CHANNEL_ERRORS)) {
        this.logger.warn(`Logs channel ${channelId} unusable (${describe(error)}): ${queue.groups.length} message(s) dropped`);
        queue.groups.length = 0;
        return;
      }
      group.attempts++;
      if (group.attempts >= MAX_ATTEMPTS) {
        remove(queue.groups, group);
        this.logger.warn(`Logs message dropped after ${MAX_ATTEMPTS} attempts in channel ${channelId}: ${describe(error)}`);
      } else {
        this.logger.warn(`Logs message to channel ${channelId} failed, retrying later: ${describe(error)}`);
      }
    }
  }

  private enqueueAll(targets: LogTarget[], ownerId: string, line: Line): void {
    for (const target of targets) this.enqueue(target.logsChannelId, ownerId, line);
  }

  /** Joins the player's open group when its last line is less than 10 s old and the text fits. */
  private enqueue(channelId: string, ownerId: string, line: Line): void {
    const now = this.options.now();
    let queue = this.channels.get(channelId);
    if (!queue) {
      queue = { groups: [] };
      this.channels.set(channelId, queue);
    }
    const text = line.text.slice(0, LOG_MAX_MESSAGE_CHARS);
    const open = queue.groups.find((g) => g.ownerId === ownerId && !g.closed && now - g.lastAt < LOG_GROUP_WINDOW_MS);
    if (open && open.length + 1 + text.length <= LOG_MAX_MESSAGE_CHARS) {
      open.lines.push({ at: line.at, text });
      open.length += 1 + text.length;
      open.lastAt = now;
      return;
    }
    if (open) open.closed = true;
    queue.groups.push({ ownerId, lines: [{ at: line.at, text }], length: text.length, lastAt: now, closed: false, attempts: 0 });
  }

  /** The session's character as the logs may show it: untracked or unknown characters are not named. */
  private async shownCharacter(characterId: bigint | null): Promise<{ names: LogCharacter; level: number | null } | null> {
    if (characterId === null) return null;
    const character = await this.store.characterOf(characterId);
    if (!character || character.role === 'untracked') return null;
    return { names: { firstName: character.firstName, surname: character.surname }, level: character.level };
  }
}

function settings(target: LogTarget): { levelAnnounceStep: number; logDeaths: boolean } {
  return { levelAnnounceStep: target.levelAnnounceStep, logDeaths: target.logDeaths };
}

function remove<T>(items: T[], item: T): void {
  const index = items.indexOf(item);
  if (index >= 0) items.splice(index, 1);
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
