import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { AppConfig } from '../common/config/config';
import { APP_CONFIG } from '../common/config/config.constants';
import { PrismaService } from '../common/prisma/prisma.service';
import type { CharacterName } from '../core/characters/character.types';
import type { Prisma } from '../generated/prisma/client';
import type { Clock } from '../ingest/clock';
import { SYNC_EVENTS, type CharacterUpdatedEvent, type EventRecordedEvent } from '../ingest/sync/sync.events';
import {
  CLOCK_SKEW_MS,
  presenceTransition,
  type DeviceState,
  type PresenceEffect,
  type PresenceInput,
  type PresenceRules,
  type PresenceState,
} from './presence-machine';
import { PRESENCE_CLOCK } from './presence.clock';
import { PRESENCE_EVENTS, type SessionEndedEvent, type SessionStartedEvent } from './presence.events';
import { buildRecap, isQuietSession, startValues, type SnapshotValues } from './session-recap';

type Tx = Prisma.TransactionClient;

interface HeartbeatInput {
  ownerId: string;
  deviceId: string;
  gameRunning: boolean;
  appVersion: string;
  lastCharacter?: CharacterName;
  /** Server reception time, ms. */
  at: number;
}

const SESSION_SELECT = {
  id: true,
  ownerId: true,
  characterId: true,
  startedAt: true,
  levelStart: true,
  moneyStart: true,
  playedStart: true,
} as const;
type SessionRow = Prisma.GameSessionGetPayload<{ select: typeof SESSION_SELECT }>;

/** What a committed step still has to do outside the transaction. */
interface Outbox {
  started: SessionStartedEvent[];
  ended: SessionEndedEvent[];
  scheduleAt: number | null;
}

/**
 * Sessions and online/offline transitions (docs/02 « Présence et sessions »). Inputs come from
 * POST /v1/heartbeat, the sync's internal events (`app` source only) and ticks (the minute job,
 * the end of the 90 s wait). Each input is one transaction that locks the player row, loads the
 * state, runs `presenceTransition` and applies its effects; inputs of a player run one at a time,
 * in arrival order.
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly rules: PresenceRules;
  private readonly queues = new Map<string, Promise<void>>();
  /** Time of each player's last `gameRunning: false` heartbeat; rebuilt from devices after a restart. */
  private readonly stoppedAt = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(PRESENCE_CLOCK) private readonly clock: Clock,
  ) {
    this.rules = { heartbeatIntervalSec: config.heartbeatIntervalSec };
  }

  /** POST /v1/heartbeat: stores game_running / last_seen_at, then applies the transition. */
  recordHeartbeat(input: HeartbeatInput): Promise<void> {
    return this.enqueue(input.ownerId, async () => {
      await this.step(input.ownerId, async (tx) => {
        await tx.device.update({
          where: { id: input.deviceId },
          data: { gameRunning: input.gameRunning, appVersion: input.appVersion, lastSeenAt: new Date(input.at) },
        });
        const characterId = input.lastCharacter ? await this.ownedCharacterId(tx, input.ownerId, input.lastCharacter) : null;
        return { kind: 'heartbeat', deviceId: input.deviceId, gameRunning: input.gameRunning, characterId, at: input.at };
      });
      if (input.gameRunning) this.stoppedAt.delete(input.ownerId);
      else this.stoppedAt.set(input.ownerId, input.at);
    });
  }

  @OnEvent(SYNC_EVENTS.characterUpdated)
  onCharacterUpdated(event: CharacterUpdatedEvent): void {
    if (event.source !== 'app') return;
    void this.enqueue(event.ownerId, () =>
      this.step(event.ownerId, async (tx) => {
        const snapshot = await tx.snapshot.findUnique({ where: { id: event.snapshotId }, select: { capturedAt: true } });
        return snapshot && { kind: 'snapshot', characterId: event.characterId, capturedAt: snapshot.capturedAt.getTime() };
      }),
    );
  }

  @OnEvent(SYNC_EVENTS.eventRecorded)
  onEventRecorded(event: EventRecordedEvent): void {
    if (event.source !== 'app' || event.type !== 'SESSION_START') return;
    const level = typeof event.data.level === 'number' ? event.data.level : null;
    void this.enqueue(event.ownerId, () =>
      this.step(event.ownerId, () =>
        Promise.resolve({ kind: 'session_start', characterId: event.characterId, at: event.at.getTime(), level }),
      ),
    );
  }

  /** Minute job: ticks every player with an open session (heartbeat_timeout, missed 90 s waits). */
  async tickAll(): Promise<void> {
    const owners = await this.prisma.gameSession.findMany({
      where: { endedAt: null },
      distinct: ['ownerId'],
      select: { ownerId: true },
    });
    await Promise.all(owners.map(({ ownerId }) => this.tick(ownerId)));
  }

  /** Resolves once every queued input has been applied (tests, shutdown). */
  async whenIdle(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  /** Forgets the in-memory state (stop times, 90 s timers), as a restart would. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.stoppedAt.clear();
  }

  onModuleDestroy(): void {
    this.reset();
  }

  private tick(ownerId: string): Promise<void> {
    return this.enqueue(ownerId, () => this.step(ownerId, () => Promise.resolve({ kind: 'tick', at: this.clock.now() })));
  }

  /** Runs `task` after the player's previous inputs; a failure is logged and never blocks the queue. */
  private enqueue(ownerId: string, task: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(ownerId) ?? Promise.resolve()).then(task);
    const settled = run.then(
      () => undefined,
      (error: unknown) => this.logger.error(`Presence update failed for player ${ownerId}`, error as Error),
    );
    this.queues.set(ownerId, settled);
    void settled.then(() => {
      if (this.queues.get(ownerId) === settled) this.queues.delete(ownerId);
    });
    return run;
  }

  private async step(ownerId: string, prepare: (tx: Tx, state: PresenceState) => Promise<PresenceInput | null>): Promise<void> {
    const outbox = await this.prisma.$transaction(async (tx) => {
      // Same lock as the sync ingestion: a player's syncs and presence updates never interleave.
      const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
      const box: Outbox = { started: [], ended: [], scheduleAt: null };
      if (locked.length === 0) return box; // player deleted (/quitter)

      const { state, session } = await this.load(tx, ownerId);
      const input = await prepare(tx, state);
      if (!input) return box;
      await this.apply(tx, ownerId, session, presenceTransition(state, input, this.rules), box);
      return box;
    });
    this.flush(ownerId, outbox);
  }

  private async load(tx: Tx, ownerId: string): Promise<{ state: PresenceState; session: SessionRow | null }> {
    const session = await tx.gameSession.findFirst({
      where: { ownerId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: SESSION_SELECT,
    });
    const rows = await tx.device.findMany({
      where: { ownerId, revokedAt: null },
      select: { id: true, gameRunning: true, lastSeenAt: true },
    });
    const devices: DeviceState[] = rows.map((d) => ({ ...d, lastSeenAt: d.lastSeenAt?.getTime() ?? null }));
    // After a restart the stop time is lost: the last contact of a stopped device stands in for it.
    const stoppedSeen = devices.filter((d) => !d.gameRunning && d.lastSeenAt !== null).map((d) => d.lastSeenAt!);
    const stoppedAt = this.stoppedAt.get(ownerId) ?? (stoppedSeen.length ? Math.max(...stoppedSeen) : null);
    return {
      session,
      state: {
        session: session && { characterId: session.characterId, startedAt: session.startedAt.getTime() },
        devices,
        stoppedAt,
      },
    };
  }

  private async apply(tx: Tx, ownerId: string, open: SessionRow | null, effects: PresenceEffect[], box: Outbox): Promise<void> {
    let session = open;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'close':
          box.ended.push(await this.close(tx, session!, effect.reason, new Date(effect.endedAt)));
          session = null;
          break;
        case 'open': {
          session = await tx.gameSession.create({
            data: { ownerId, characterId: effect.characterId, startedAt: new Date(effect.startedAt) },
            select: SESSION_SELECT,
          });
          if (effect.characterId !== null) session = await this.fillCharacter(tx, session, effect.characterId);
          if (effect.levelStart !== null) session = await this.lowerStartLevel(tx, session, effect.levelStart);
          box.started.push({ sessionId: session.id, ownerId, characterId: session.characterId, startedAt: session.startedAt });
          break;
        }
        case 'attach':
          session = await this.fillCharacter(tx, session!, effect.characterId);
          break;
        case 'update_end':
          session = await this.updateEnd(tx, session!, effect.characterId);
          break;
        case 'start_level':
          session = await this.lowerStartLevel(tx, session!, effect.level);
          break;
        case 'schedule_close':
          box.scheduleAt = effect.at;
          break;
      }
    }
  }

  /** Sets the character, its start values (last snapshot before the session) and its end values. */
  private async fillCharacter(tx: Tx, session: SessionRow, characterId: bigint): Promise<SessionRow> {
    const baseline = await tx.snapshot.findFirst({
      where: { characterId, capturedAt: { lt: session.startedAt } },
      orderBy: { capturedAt: 'desc' },
      select: SNAPSHOT_VALUES,
    });
    const latest = await tx.snapshot.findFirst({
      where: { characterId, capturedAt: { gte: session.startedAt } },
      orderBy: { capturedAt: 'desc' },
      select: SNAPSHOT_VALUES,
    });
    return tx.gameSession.update({
      where: { id: session.id },
      data: { characterId, ...startValues({ baseline, first: latest }), ...(latest ? endValues(latest) : {}) },
      select: SESSION_SELECT,
    });
  }

  /** End values from the character's last snapshot; start values from it when still unknown. */
  private async updateEnd(tx: Tx, session: SessionRow, characterId: bigint): Promise<SessionRow> {
    const character = await tx.character.findUnique({ where: { id: characterId }, select: { lastSnapshotId: true } });
    const latest = character?.lastSnapshotId
      ? await tx.snapshot.findUnique({ where: { id: character.lastSnapshotId }, select: SNAPSHOT_VALUES })
      : null;
    if (!latest) return session;
    const start = session.levelStart === null ? startValues({ baseline: null, first: latest }) : {};
    return tx.gameSession.update({
      where: { id: session.id },
      data: { ...start, ...endValues(latest) },
      select: SESSION_SELECT,
    });
  }

  private lowerStartLevel(tx: Tx, session: SessionRow, level: number): Promise<SessionRow> {
    const levelStart = session.levelStart === null ? level : Math.min(session.levelStart, level);
    return tx.gameSession.update({ where: { id: session.id }, data: { levelStart }, select: SESSION_SELECT });
  }

  private async close(tx: Tx, session: SessionRow, reason: SessionEndedEvent['reason'], endedAt: Date): Promise<SessionEndedEvent> {
    const row = await tx.gameSession.update({ where: { id: session.id }, data: { endedAt, endReason: reason } });
    // Snapshot times come from the client clock: allow the skew margin on both ends.
    const zoneRow =
      row.characterId === null
        ? null
        : await tx.snapshot.findFirst({
            where: {
              characterId: row.characterId,
              capturedAt: {
                gte: new Date(row.startedAt.getTime() - CLOCK_SKEW_MS),
                lte: new Date(endedAt.getTime() + CLOCK_SKEW_MS),
              },
            },
            orderBy: { capturedAt: 'desc' },
            select: { zone: true, subZone: true },
          });
    const deaths =
      row.characterId === null
        ? 0
        : await tx.gameEvent.count({
            where: { characterId: row.characterId, type: 'DEATH', at: { gte: row.startedAt, lte: endedAt } },
          });
    const recap = buildRecap({
      startedAt: row.startedAt,
      endedAt,
      levelStart: row.levelStart,
      levelEnd: row.levelEnd,
      moneyStart: row.moneyStart,
      moneyEnd: row.moneyEnd,
      playedStart: row.playedStart,
      playedEnd: row.playedEnd,
      endZone: zoneRow?.zone ?? null,
      endSubZone: zoneRow?.subZone ?? null,
      deaths,
    });
    return {
      sessionId: row.id,
      ownerId: row.ownerId,
      characterId: row.characterId,
      startedAt: row.startedAt,
      endedAt,
      reason,
      recap,
      quiet: isQuietSession(recap),
    };
  }

  /** The player's own character with that identity (any role), else null. */
  private async ownedCharacterId(tx: Tx, ownerId: string, key: CharacterName): Promise<bigint | null> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM "character"
      WHERE region = ${key.region} AND owner_id = ${ownerId}
        AND lower(first_name) = lower(${key.firstName.normalize('NFC')})
        AND lower(surname) = lower(${key.surname.normalize('NFC')})`;
    return rows[0]?.id ?? null;
  }

  /** After commit: events, then the 90 s timer. Listener failures never undo a committed step. */
  private flush(ownerId: string, box: Outbox): void {
    try {
      for (const event of box.ended) this.emitter.emit(PRESENCE_EVENTS.sessionEnded, event);
      for (const event of box.started) this.emitter.emit(PRESENCE_EVENTS.sessionStarted, event);
    } catch (error) {
      this.logger.error(`Session event listener failed for player ${ownerId}`, error as Error);
    }
    if (box.scheduleAt !== null) this.schedule(ownerId, box.scheduleAt);
  }

  private schedule(ownerId: string, at: number): void {
    clearTimeout(this.timers.get(ownerId));
    const timer = setTimeout(
      () => {
        this.timers.delete(ownerId);
        void this.tick(ownerId);
      },
      Math.max(0, at - this.clock.now()),
    );
    timer.unref();
    this.timers.set(ownerId, timer);
  }
}

const SNAPSHOT_VALUES = { level: true, money: true, playedTotal: true } as const;

function endValues(s: SnapshotValues) {
  return { levelEnd: s.level, moneyEnd: s.money, playedEnd: s.playedTotal };
}
