import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AppConfig, Region } from '../../common/config/config';
import { APP_CONFIG } from '../../common/config/config.constants';
import { decryptToken } from '../../common/crypto/token-cipher';
import { PrismaService } from '../../common/prisma/prisma.service';
import { retryOnUniqueViolation } from '../../common/prisma/unique-violation';
import type { CharacterRole } from '../../core/characters/character.types';
import type { Prisma } from '../../generated/prisma/client';
import { judgeSnapshot, type SyncFlag } from '../../ingest/sync/sync-rules';
import { SYNC_EVENTS, type CharacterUpdatedEvent, type EventRecordedEvent } from '../../ingest/sync/sync.events';
import { BnetClient, BnetUnauthorizedError, type BnetAccountProfile } from '../client';
import { accountCharacters, type AccountCharacter } from '../oauth/account-characters';
import { deduceLevelUps } from './level-ups';
import { BNET_POLL_CLOCK, type PollClock } from './poll-clock';

type Tx = Prisma.TransactionClient;

interface StoredToken {
  ownerId: string;
  region: string;
  tokenEncrypted: Uint8Array;
}

interface Applied {
  characterId: bigint;
  role: CharacterRole;
  snapshot: { id: bigint; level: number };
  events: Array<{ id: bigint; eventId: string; type: string; at: Date; data: Record<string, unknown> }>;
  flags: SyncFlag[];
}

const SOURCE = 'bnet_account' as const;

const roleOf = (role: string | null): CharacterRole => (role === 'main' || role === 'alt' ? role : 'untracked');

/**
 * Base-mode readings of the account profile (docs/02 « Mode de base », « Sources et rythme » and
 * « Événements déduits »). For every valid bnet_token: read the profile, store a `bnet_account`
 * snapshot for each of the owner's characters whose level changed, and deduce one LEVEL_UP per
 * level gained. Expired tokens are deleted, as are tokens Battle.net refuses twice in a row.
 * Never logs a token.
 */
@Injectable()
export class BnetAccountPoller {
  private readonly logger = new Logger(BnetAccountPoller.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bnet: BnetClient,
    private readonly emitter: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BNET_POLL_CLOCK) private readonly clock: PollClock,
  ) {}

  async pollAll(): Promise<void> {
    const now = new Date(this.clock.now());
    const expired = await this.prisma.bnetToken.deleteMany({ where: { expiresAt: { lte: now } } });
    if (expired.count > 0) this.logger.log(`Deleted ${expired.count} expired Battle.net token(s)`);

    const tokens = await this.prisma.bnetToken.findMany({
      where: { expiresAt: { gt: now } },
      select: { ownerId: true, region: true, tokenEncrypted: true },
      orderBy: { ownerId: 'asc' },
    });
    for (const token of tokens) {
      try {
        await this.pollOwner(token, now);
      } catch (error) {
        this.logger.error(`Battle.net polling failed for ${token.ownerId}: ${describe(error)}`);
      }
    }
  }

  private async pollOwner(token: StoredToken, now: Date): Promise<void> {
    let accessToken: string;
    try {
      accessToken = decryptToken(this.config.tokenEncKey, Buffer.from(token.tokenEncrypted));
    } catch {
      // Unreadable (key changed or corrupted row): useless, the player has to link again.
      this.logger.warn(`Battle.net token of ${token.ownerId} cannot be decrypted: deleted`);
      await this.deleteToken(token.ownerId);
      return;
    }

    const region = token.region as Region;
    const profile = await this.accountProfile(token.ownerId, region, accessToken);
    if (!profile) return;

    for (const character of accountCharacters(profile)) {
      if (character.level === null) continue;
      try {
        const applied = await retryOnUniqueViolation(() =>
          this.prisma.$transaction((tx) => this.apply(tx, token.ownerId, region, character, now)),
        );
        if (applied) this.emitAll(token.ownerId, applied);
      } catch (error) {
        this.logger.error(`Battle.net reading of a character of ${token.ownerId} failed: ${describe(error)}`);
      }
    }
  }

  /** docs/02 « Erreurs »: a 401 / 403 is retried once; a second refusal deletes the token. */
  private async accountProfile(ownerId: string, region: Region, accessToken: string): Promise<BnetAccountProfile | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.bnet.getAccountProfile(region, accessToken);
      } catch (error) {
        if (!(error instanceof BnetUnauthorizedError)) throw error;
        if (attempt >= 2) {
          this.logger.warn(`Battle.net refused the token of ${ownerId} (HTTP ${error.status}): deleted`);
          await this.deleteToken(ownerId);
          return null;
        }
      }
    }
  }

  private async apply(tx: Tx, ownerId: string, region: Region, found: AccountCharacter, now: Date): Promise<Applied | null> {
    const level = found.level!;
    // Same lock order as SyncService and CharacterService: the owner's row, then the character.
    await tx.$queryRaw`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ id: bigint; role: string | null; lastSnapshotId: bigint | null }>>`
      SELECT id, role, last_snapshot_id AS "lastSnapshotId"
      FROM "character"
      WHERE region = ${region} AND owner_id = ${ownerId}
        AND lower(first_name) = lower(${found.firstName}) AND lower(surname) = lower(${found.surname})
      FOR UPDATE`;
    const character = rows[0];
    // Characters are created or attached by /lier battlenet only; others are not ours to touch.
    if (!character) return null;

    const previous = character.lastSnapshotId
      ? await tx.snapshot.findUnique({ where: { id: character.lastSnapshotId }, select: { capturedAt: true, level: true } })
      : null;
    // Unchanged, or lower than what is stored (an older reading): nothing to record.
    if (previous && level <= previous.level) return null;

    const capturedAt = Math.floor(now.getTime() / 1_000);
    const verdict = judgeSnapshot(
      previous && { capturedAt: Math.floor(previous.capturedAt.getTime() / 1_000), level: previous.level },
      { capturedAt, level },
    );
    if (verdict.action !== 'store') return null;
    const flags = verdict.flags;

    const snapshot = await tx.snapshot.create({
      data: { characterId: character.id, capturedAt: now, level, detail: {}, source: SOURCE, flags },
      select: { id: true, level: true },
    });
    await tx.character.update({
      where: { id: character.id },
      data: { lastSnapshotId: snapshot.id, ...identityFields(found) },
    });

    const events = previous ? await this.recordLevelUps(tx, character.id, previous.level, level, now, flags) : [];
    return { characterId: character.id, role: roleOf(character.role), snapshot, events, flags };
  }

  /**
   * One LEVEL_UP per level gained, `bnet-<character_id>-<level>`. Levels the addon already reported
   * (a /sync carrying its own LEVEL_UP) are skipped, so a level is never deduced twice.
   */
  private async recordLevelUps(tx: Tx, characterId: bigint, from: number, to: number, at: Date, flags: SyncFlag[]) {
    const known = await tx.gameEvent.findMany({ where: { characterId, type: 'LEVEL_UP' }, select: { data: true } });
    const reported = new Set(known.map((e) => (e.data as { level?: unknown } | null)?.level).filter((l) => typeof l === 'number'));
    const deduced = deduceLevelUps(characterId, from, to, at).filter((e) => !reported.has(e.data.level));
    if (deduced.length === 0) return [];
    const inserted = await tx.gameEvent.createManyAndReturn({
      data: deduced.map((e) => ({ characterId, eventId: e.eventId, type: e.type, at: e.at, data: e.data, flags })),
      skipDuplicates: true,
      select: { id: true, eventId: true, type: true, at: true, data: true },
    });
    const order = new Map(deduced.map((e, i) => [e.eventId, i] as const));
    return inserted
      .sort((a, b) => order.get(a.eventId)! - order.get(b.eventId)!)
      .map((e) => ({ ...e, data: e.data as Record<string, unknown> }));
  }

  /** Same internal events as a sync, after commit; listener failures never undo the reading. */
  private emitAll(ownerId: string, applied: Applied): void {
    const { characterId, role, snapshot, events, flags } = applied;
    try {
      const updated: CharacterUpdatedEvent = {
        characterId,
        ownerId,
        role,
        snapshotId: snapshot.id,
        level: snapshot.level,
        source: SOURCE,
        flags,
      };
      this.emitter.emit(SYNC_EVENTS.characterUpdated, updated);
      for (const event of events) {
        const recorded: EventRecordedEvent = { ...event, characterId, ownerId, role, source: SOURCE, flags };
        this.emitter.emit(SYNC_EVENTS.eventRecorded, recorded);
      }
    } catch (error) {
      this.logger.error(`Battle.net event listener failed for character ${characterId}: ${describe(error)}`);
    }
  }

  private async deleteToken(ownerId: string): Promise<void> {
    await this.prisma.bnetToken.deleteMany({ where: { ownerId } });
  }
}

/** Class, race and faction from the profile; an absent value never erases a known one. */
function identityFields(c: AccountCharacter): Partial<Record<'classFile' | 'raceFile' | 'faction', string>> {
  const fields = { classFile: c.classFile, raceFile: c.raceFile, faction: c.faction };
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== null));
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
