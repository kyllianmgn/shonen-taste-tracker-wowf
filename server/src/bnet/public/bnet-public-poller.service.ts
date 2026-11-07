import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SYNC_EVENTS, type CharacterUpdatedEvent, type EventRecordedEvent } from '../../ingest/sync/sync.events';
import { PRESENCE_EVENTS, type SessionEndedEvent } from '../../presence/presence.events';
import { buildRecap } from '../../presence/session-recap';
import { BnetClient } from '../client';
import { BNET_POLL_CLOCK, type PollClock } from '../polling/poll-clock';
import { PUBLIC_POLL_STORE, type AppliedPublicReading, type PublicPollStore, type PublicPollTarget } from './public-poll.store';
import { PublicProfileGate } from './public-profile-gate';
import { planUnchanged, readPublicCharacter } from './public-reading';

/** Characters read per pass at most; the rest are due at the next pass. */
export const PUBLIC_POLL_BATCH = 500;

const SOURCE = 'bnet_public' as const;

/**
 * Public profile readings of base-mode characters (docs/02 « Mode de base », « Sources et rythme »):
 * each due character is read with If-Modified-Since; a 304 or 404 records nothing, a 200 may store
 * a `bnet_public` snapshot, LEVEL_UPs and a session end deduced from `last_login_timestamp`.
 */
@Injectable()
export class BnetPublicPoller {
  private readonly logger = new Logger(BnetPublicPoller.name);

  constructor(
    @Inject(PUBLIC_POLL_STORE) private readonly store: PublicPollStore,
    private readonly bnet: BnetClient,
    private readonly emitter: EventEmitter2,
    private readonly gate: PublicProfileGate,
    @Inject(BNET_POLL_CLOCK) private readonly clock: PollClock,
  ) {}

  async pollDue(): Promise<void> {
    if (!this.gate.enabled) return;
    const now = new Date(this.clock.now());
    const targets = await this.store.dueTargets(now, PUBLIC_POLL_BATCH);
    for (const target of targets) {
      try {
        await this.pollOne(target, now);
      } catch (error) {
        this.logger.error(`Public profile reading of character ${target.characterId} failed: ${describe(error)}`);
        // Wait for the normal interval rather than hammering a failing profile every pass.
        await this.store.reschedule(target.characterId, planUnchanged(target.poll, now)).catch(() => undefined);
      }
    }
  }

  private async pollOne(target: PublicPollTarget, now: Date): Promise<void> {
    const result = await this.bnet.getPublicCharacter(
      target.region,
      target.firstName,
      target.surname,
      target.poll?.lastModified ?? undefined,
    );
    if (result.status !== 200) {
      await this.store.reschedule(target.characterId, planUnchanged(target.poll, now));
      return;
    }
    const applied = await this.store.applyReading(target, readPublicCharacter(result.character, result.lastModified), now);
    if (applied) this.emitAll(applied);
  }

  /** Same internal events as a sync, then session.ended; listener failures never undo the reading. */
  private emitAll(applied: AppliedPublicReading): void {
    const { characterId, ownerId, role, snapshot, events, flags, session } = applied;
    try {
      if (snapshot) {
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
      }
      for (const event of events) {
        const recorded: EventRecordedEvent = { ...event, characterId, ownerId, role, source: SOURCE, flags };
        this.emitter.emit(SYNC_EVENTS.eventRecorded, recorded);
      }
      if (session) this.emitter.emit(PRESENCE_EVENTS.sessionEnded, sessionEnded(ownerId, characterId, session));
    } catch (error) {
      this.logger.error(`Public profile event listener failed for character ${characterId}: ${describe(error)}`);
    }
  }
}

/** The start is unknown: the session is stamped at `last_login_timestamp` and lasts 0 s. */
function sessionEnded(ownerId: string, characterId: bigint, session: NonNullable<AppliedPublicReading['session']>): SessionEndedEvent {
  const recap = buildRecap({
    startedAt: session.endedAt,
    endedAt: session.endedAt,
    levelStart: session.levelStart,
    levelEnd: session.levelEnd,
    moneyStart: null,
    moneyEnd: null,
    playedStart: null,
    playedEnd: null,
    endZone: null,
    endSubZone: null,
    deaths: 0,
  });
  return {
    sessionId: session.id,
    ownerId,
    characterId,
    startedAt: session.endedAt,
    endedAt: session.endedAt,
    reason: 'bnet_logout',
    recap,
    quiet: false,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
