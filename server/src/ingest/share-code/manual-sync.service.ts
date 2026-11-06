import { Inject, Injectable } from '@nestjs/common';
import { ContractValidator } from '../../common/contract/contract-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SlidingWindowLimiter, type WindowRule } from '../auth/sliding-window-limiter';
import { INGEST_CLOCK, type Clock } from '../clock';
import { SyncService } from '../sync/sync.service';
import type { SyncRequest, SyncResult } from '../sync/sync.types';
import { readSavedVariablesFile } from './saved-variables-file';
import { decodeShareCode, toSyncRequest, type Decoded, type ManualSyncRefusal } from './share-code';

export type { ManualSyncRefusal } from './share-code';

/** « au plus une fois toutes les 2 min » per member (docs/02 « Sources et rythme des relevés »). */
export const MANUAL_SYNC_RATE_LIMIT = { limit: 1, windowSec: 120 } as const satisfies WindowRule;

/** A loader (attachment download) stops with this to refuse the file. */
export class ManualSyncInputError extends Error {
  constructor(readonly reason: ManualSyncRefusal) {
    super(`Manual sync input refused: ${reason}`);
    this.name = 'ManualSyncInputError';
  }
}

export type ManualSyncInput =
  | { kind: 'code'; text: string }
  /** Lazy, so the rate limit is checked before anything is downloaded. */
  | { kind: 'file'; load: () => Promise<Buffer> };

export type ManualSyncOutcome =
  | { status: 'rate_limited'; retryAfterSec: number }
  | { status: 'refused'; reason: ManualSyncRefusal; detail?: string }
  | { status: 'done'; results: SyncResult[] };

/**
 * /sync of the base mode (docs/02 « Commande /sync »): a `/ftr share` code or a ForeverTracker.lua
 * file, ingested by SyncService with source `manual`. Same statuses and flags as POST /v1/sync:
 * characters owned by another member come back `owned_by_other` and nothing is stored for them.
 */
@Injectable()
export class ManualSyncService {
  constructor(
    private readonly sync: SyncService,
    private readonly contract: ContractValidator,
    private readonly prisma: PrismaService,
    private readonly limiter: SlidingWindowLimiter,
    @Inject(INGEST_CLOCK) private readonly clock: Clock,
  ) {}

  async run(input: { ownerId: string; guildId: string; input: ManualSyncInput }): Promise<ManualSyncOutcome> {
    // Every attempt counts, refused ones included, like the /v1 limits.
    const hit = this.limiter.hit(`discord.sync|member:${input.ownerId}`, MANUAL_SYNC_RATE_LIMIT, this.clock.now());
    if (!hit.allowed) return { status: 'rate_limited', retryAfterSec: hit.retryAfterSec };

    const decoded = await this.decode(input.input);
    if (!decoded.ok) return { status: 'refused', reason: decoded.reason, ...(decoded.detail ? { detail: decoded.detail } : {}) };

    await this.ensureMember(input.ownerId, input.guildId);
    const response = await this.sync.ingest({ ownerId: input.ownerId, payload: decoded.payload, source: 'manual' });
    return { status: 'done', results: response.results };
  }

  private async decode(input: ManualSyncInput): Promise<Decoded<SyncRequest>> {
    if (input.kind === 'code') {
      const decoded = decodeShareCode(input.text, this.contract);
      return decoded.ok ? { ok: true, payload: toSyncRequest(decoded.payload) } : decoded;
    }
    let bytes: Buffer;
    try {
      bytes = await input.load();
    } catch (error) {
      if (error instanceof ManualSyncInputError) return { ok: false, reason: error.reason };
      throw error;
    }
    return readSavedVariablesFile(bytes, this.contract, Math.floor(this.clock.now() / 1_000));
  }

  /**
   * Like /lier appli and /lier battlenet: the player row (owner of the characters), and the member
   * shows on this server's board (guild_config gets its defaults if /setup never ran).
   */
  private async ensureMember(ownerId: string, guildId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`INSERT INTO guild_config (guild_id) VALUES (${guildId}) ON CONFLICT DO NOTHING`,
      this.prisma.$executeRaw`
        INSERT INTO membership (guild_id, discord_user_id) VALUES (${guildId}, ${ownerId}) ON CONFLICT DO NOTHING`,
    ]);
  }
}
