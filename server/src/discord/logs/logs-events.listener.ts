import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CHARACTER_EVENTS, type CharacterTrackedEvent } from '../../core/characters/character.events';
import { SYNC_EVENTS, type EventRecordedEvent } from '../../ingest/sync/sync.events';
import { PRESENCE_EVENTS, type SessionEndedEvent, type SessionStartedEvent } from '../../presence/presence.events';
import { LogsPublisher } from './logs-publisher';

/** Feeds the logs publisher; a failure is logged, never thrown back at the emitter. */
@Injectable()
export class LogsEventsListener {
  private readonly logger = new Logger(LogsEventsListener.name);

  constructor(private readonly publisher: LogsPublisher) {}

  @OnEvent(SYNC_EVENTS.eventRecorded)
  onEventRecorded(event: EventRecordedEvent): Promise<void> {
    return this.guard(() => this.publisher.onEventRecorded(event));
  }

  @OnEvent(PRESENCE_EVENTS.sessionStarted)
  onSessionStarted(event: SessionStartedEvent): Promise<void> {
    return this.guard(() => this.publisher.onSessionStarted(event));
  }

  @OnEvent(PRESENCE_EVENTS.sessionEnded)
  onSessionEnded(event: SessionEndedEvent): Promise<void> {
    return this.guard(() => this.publisher.onSessionEnded(event));
  }

  @OnEvent(CHARACTER_EVENTS.tracked)
  onCharacterTracked(event: CharacterTrackedEvent): Promise<void> {
    return this.guard(() => this.publisher.onCharacterTracked(event));
  }

  private async guard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(`Could not queue a log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
