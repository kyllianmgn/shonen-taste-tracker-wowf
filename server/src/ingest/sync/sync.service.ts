import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppConfig } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { retryOnUniqueViolation } from '../../common/prisma/unique-violation';
import type { CharacterRole, TrackedRole } from '../../core/characters/character.types';
import type { Prisma } from '../../generated/prisma/client';
import { INGEST_CLOCK, type Clock } from '../clock';
import { assignRole, checkPayloadCharacter, judgeSnapshot, type SyncFlag } from './sync-rules';
import {
  SYNC_EVENTS,
  type CharacterUpdatedEvent,
  type EventRecordedEvent,
  type SnapshotSource,
} from './sync.events';
import type { SyncCharacter, SyncRequest, SyncResponse, SyncResult } from './sync.types';

type Tx = Prisma.TransactionClient;

interface StoredCharacter {
  id: bigint;
  ownerId: string | null;
  role: string | null;
  lastSnapshotId: bigint | null;
}

/** What one character's transaction did, kept to emit the internal events after commit. */
type Applied =
  | { result: SyncResult; emit?: undefined }
  | {
      result: SyncResult;
      emit: {
        characterId: bigint;
        role: CharacterRole;
        snapshot: { id: bigint; level: number } | null;
        events: Omit<EventRecordedEvent, 'characterId' | 'ownerId' | 'role' | 'source'>[];
        flags: SyncFlag[];
      };
    };

/** Snapshot fields stored in their own columns; everything else goes to `detail`. */
const COLUMN_FIELDS = ['capturedAt', 'level', 'xp', 'xpMax', 'money', 'playedTotal', 'zone', 'subZone'] as const;

const roleOf = (c: { role: string | null }): CharacterRole =>
  c.role === 'main' || c.role === 'alt' ? c.role : 'untracked';

/**
 * Ingestion of a sync (docs/02 « Synchro », « Règles de validation »): ownership, snapshots and
 * deduplicated events, one transaction per character so one bad character never blocks the others.
 * Used by POST /v1/sync (source `app`) and by /sync through ManualSyncService (source `manual`).
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  async ingest(input: { ownerId: string; payload: SyncRequest; source: SnapshotSource }): Promise<SyncResponse> {
    const results: SyncResult[] = [];
    for (const character of input.payload.characters) {
      results.push(await this.ingestCharacter(input.ownerId, character, input.source));
    }
    return { heartbeatIntervalSec: this.config.heartbeatIntervalSec, results };
  }

  private async ingestCharacter(ownerId: string, character: SyncCharacter, source: SnapshotSource): Promise<SyncResult> {
    const key = {
      region: character.key.region,
      firstName: character.key.firstName,
      surname: character.key.surname,
    };
    const flags = checkPayloadCharacter(character, this.clock.now(), this.config.levelCap);
    if (flags.length > 0) return { key, status: 'rejected', acceptedEvents: 0, duplicateEvents: 0, flags };

    const applied = await retryOnUniqueViolation(() =>
      this.prisma.$transaction((tx) => this.apply(tx, ownerId, character, source)),
    );
    if (applied.emit) this.emitAll(ownerId, source, applied.emit);
    return { ...applied.result, key };
  }

  private async apply(tx: Tx, ownerId: string, character: SyncCharacter, source: SnapshotSource): Promise<Applied> {
    const { key, snapshot } = character;
    const rejected = (status: SyncResult['status'], flags: SyncFlag[] = []): Applied => ({
      result: { key, status, acceptedEvents: 0, duplicateEvents: 0, flags },
    });

    // The device owner's row serializes their syncs and their /perso commands (CharacterService).
    await tx.$queryRaw`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
    const existing = await this.findByIdentity(tx, key);
    if (existing && existing.ownerId !== null && existing.ownerId !== ownerId) return rejected('owned_by_other');

    const role: CharacterRole =
      existing && existing.ownerId === ownerId ? roleOf(existing) : assignRole(await this.trackedRoles(tx, ownerId));

    const previous = existing?.lastSnapshotId
      ? await tx.snapshot.findUnique({
          where: { id: existing.lastSnapshotId },
          select: { capturedAt: true, level: true, playedTotal: true },
        })
      : null;
    const verdict = judgeSnapshot(
      previous && { ...previous, capturedAt: Math.floor(previous.capturedAt.getTime() / 1_000) },
      snapshot,
    );
    if (verdict.action === 'reject') return rejected('rejected', verdict.flags);
    const flags = verdict.action === 'store' ? verdict.flags : [];

    const identity = verdict.action === 'store' ? identityFields(character) : {};
    const characterId = existing
      ? (await tx.character.update({ where: { id: existing.id }, data: { ownerId, role, ...identity }, select: { id: true } })).id
      : (
          await tx.character.create({
            data: { region: key.region, firstName: nfc(key.firstName), surname: nfc(key.surname), ownerId, role, ...identity },
            select: { id: true },
          })
        ).id;

    let stored: { id: bigint; level: number } | null = null;
    if (verdict.action === 'store') {
      stored = await tx.snapshot.create({ data: snapshotRow(characterId, character, source, flags), select: { id: true, level: true } });
      await tx.character.update({ where: { id: characterId }, data: { lastSnapshotId: stored.id } });
    }

    const inserted = character.events.length
      ? await tx.gameEvent.createManyAndReturn({
          data: character.events.map((e) => ({
            characterId,
            eventId: e.id,
            type: e.type,
            at: new Date(e.at * 1_000),
            data: e.data as Prisma.InputJsonObject,
            flags,
          })),
          skipDuplicates: true,
          select: { id: true, eventId: true, type: true, at: true, data: true },
        })
      : [];
    // Emit in the order the addon wrote them.
    const order = new Map(character.events.map((e, i) => [e.id, i] as const));
    inserted.sort((a, b) => order.get(a.eventId)! - order.get(b.eventId)!);

    return {
      result: {
        key,
        status: role === 'untracked' ? 'untracked' : 'ok',
        acceptedEvents: inserted.length,
        duplicateEvents: character.events.length - inserted.length,
        flags,
      },
      emit: {
        characterId,
        role,
        snapshot: stored,
        events: inserted.map((e) => ({ ...e, data: e.data as Record<string, unknown>, flags })),
        flags,
      },
    };
  }

  /** Listener failures must not fail a sync that is already committed. */
  private emitAll(ownerId: string, source: SnapshotSource, applied: NonNullable<Applied['emit']>): void {
    const { characterId, role, snapshot, events, flags } = applied;
    try {
      if (snapshot) {
        const updated: CharacterUpdatedEvent = {
          characterId,
          ownerId,
          role,
          snapshotId: snapshot.id,
          level: snapshot.level,
          source,
          flags,
        };
        this.emitter.emit(SYNC_EVENTS.characterUpdated, updated);
      }
      for (const event of events) {
        const recorded: EventRecordedEvent = { ...event, characterId, ownerId, role, source };
        this.emitter.emit(SYNC_EVENTS.eventRecorded, recorded);
      }
    } catch (error) {
      this.logger.error(`Sync event listener failed for character ${characterId}`, error as Error);
    }
  }

  private async trackedRoles(tx: Tx, ownerId: string): Promise<TrackedRole[]> {
    const rows = await tx.character.findMany({ where: { ownerId, role: { in: ['main', 'alt'] } }, select: { role: true } });
    return rows.map((r) => r.role as TrackedRole);
  }

  /** Case-insensitive lookup matching the character_identity_key index, locked for this transaction. */
  private async findByIdentity(
    tx: Tx,
    key: { region: string; firstName: string; surname: string },
  ): Promise<StoredCharacter | null> {
    const rows = await tx.$queryRaw<StoredCharacter[]>`
      SELECT id, owner_id AS "ownerId", role, last_snapshot_id AS "lastSnapshotId"
      FROM "character"
      WHERE region = ${key.region}
        AND lower(first_name) = lower(${nfc(key.firstName)}) AND lower(surname) = lower(${nfc(key.surname)})
      FOR UPDATE`;
    return rows[0] ?? null;
  }
}

function nfc(name: string): string {
  return name.normalize('NFC');
}

/** Character columns refreshed from a stored snapshot; absent values keep what is stored. */
type IdentityFields = Partial<Record<'guid' | 'realmName' | 'classFile' | 'raceFile' | 'faction', string>>;

function identityFields(character: SyncCharacter): IdentityFields {
  const { key, snapshot } = character;
  const fields: IdentityFields = {
    guid: key.guid,
    realmName: key.realmName,
    classFile: snapshot.classFile,
    raceFile: snapshot.raceFile,
    faction: snapshot.faction,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

function snapshotRow(
  characterId: bigint,
  character: SyncCharacter,
  source: SnapshotSource,
  flags: SyncFlag[],
): Prisma.SnapshotUncheckedCreateInput {
  const s = character.snapshot;
  const detail = Object.fromEntries(
    Object.entries(s).filter(([field]) => !(COLUMN_FIELDS as readonly string[]).includes(field)),
  ) as Prisma.InputJsonObject;
  return {
    characterId,
    capturedAt: new Date(s.capturedAt * 1_000),
    level: s.level,
    xp: s.xp,
    xpMax: s.xpMax,
    money: s.money === undefined ? undefined : BigInt(s.money),
    playedTotal: s.playedTotal,
    zone: s.zone,
    subZone: s.subZone,
    detail,
    source,
    flags,
  };
}
