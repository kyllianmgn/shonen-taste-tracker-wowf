import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNC_EVENTS, type CharacterUpdatedEvent } from '../../ingest/sync/sync.events';
import { BoardPublisher } from './board-publisher';

/** Names of the presence module's events (docs/02 « Modules »). */
export const SESSION_EVENTS = {
  started: 'session.started',
  ended: 'session.ended',
} as const;

/** The part of a session.* event the board needs: whose presence changed. */
export interface SessionEventLike {
  ownerId?: string;
}

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

  @OnEvent(SESSION_EVENTS.started)
  async onSessionStarted(event: SessionEventLike): Promise<void> {
    await this.markPlayer(event.ownerId);
  }

  @OnEvent(SESSION_EVENTS.ended)
  async onSessionEnded(event: SessionEventLike): Promise<void> {
    await this.markPlayer(event.ownerId);
  }

  private async markPlayer(ownerId: string | undefined): Promise<void> {
    if (!ownerId) {
      this.publisher.markAllDirty();
      return;
    }
    try {
      await this.publisher.markPlayerDirty(ownerId);
    } catch (error) {
      this.logger.error(`Could not mark the boards of a player: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
