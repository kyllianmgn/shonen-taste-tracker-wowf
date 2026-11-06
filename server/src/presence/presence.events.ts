import type { EndReason } from './presence-machine';
import type { SessionRecap } from './session-recap';

/**
 * Internal events emitted by the presence engine (docs/02 « Modules »), through EventEmitter2,
 * after the transaction that opened or closed the session is committed.
 */
export const PRESENCE_EVENTS = {
  sessionStarted: 'session.started',
  sessionEnded: 'session.ended',
} as const;

export interface SessionStartedEvent {
  /** game_session.id */
  sessionId: bigint;
  ownerId: string;
  /** Null until a heartbeat or a sync names the character. */
  characterId: bigint | null;
  startedAt: Date;
}

export interface SessionEndedEvent {
  sessionId: bigint;
  ownerId: string;
  characterId: bigint | null;
  startedAt: Date;
  endedAt: Date;
  reason: EndReason;
  recap: SessionRecap;
  /** Under 2 min without any change: closed without log (docs/02 « Récap de session »). */
  quiet: boolean;
}
