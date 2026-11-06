import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNC_EVENTS, type CharacterUpdatedEvent } from '../../ingest/sync/sync.events';
import { PRESENCE_EVENTS, type SessionEndedEvent, type SessionStartedEvent } from '../../presence/presence.events';
import { BoardPublisher } from './board-publisher';

/** Marks the boards to redraw when a shown character or a player's presence changes. */
@Injectable()
export class BoardEventsListener {
  private readonly logger = new Logger(BoardEventsListener.name);

  constructor(private readonly publisher: BoardPublisher) {}

  @OnEvent(SYNC_EVENTS.characterUpdated)
  async onCharacterUpdated(event: CharacterUpdatedEvent): Promise<void> {
    if (event.role === 'untracked') return;
    await this.markPlayer(event.ownerId);
  }

  @OnEvent(PRESENCE_EVENTS.sessionStarted)
  async onSessionStarted(event: SessionStartedEvent): Promise<void> {
    await this.markPlayer(event.ownerId);
  }

  @OnEvent(PRESENCE_EVENTS.sessionEnded)
  async onSessionEnded(event: SessionEndedEvent): Promise<void> {
    await this.markPlayer(event.ownerId);
  }

  private async markPlayer(ownerId: string): Promise<void> {
    try {
      await this.publisher.markPlayerDirty(ownerId);
    } catch (error) {
      this.logger.error(`Could not mark the boards of a player: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
