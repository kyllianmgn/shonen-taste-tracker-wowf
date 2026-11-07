import type { CharacterTrackedEvent } from '../../core/characters/character.events';
import type { EventRecordedEvent } from '../../ingest/sync/sync.events';
import type { SessionEndedEvent, SessionStartedEvent } from '../../presence/presence.events';
import { LogsEventsListener } from './logs-events.listener';
import type { LogsPublisher } from './logs-publisher';

describe('LogsEventsListener', () => {
  let publisher: Record<'onEventRecorded' | 'onSessionStarted' | 'onSessionEnded' | 'onCharacterTracked', jest.Mock>;
  let listener: LogsEventsListener;

  beforeEach(() => {
    publisher = {
      onEventRecorded: jest.fn().mockResolvedValue(undefined),
      onSessionStarted: jest.fn().mockResolvedValue(undefined),
      onSessionEnded: jest.fn().mockResolvedValue(undefined),
      onCharacterTracked: jest.fn().mockResolvedValue(undefined),
    };
    listener = new LogsEventsListener(publisher as unknown as LogsPublisher);
  });

  it('hands every subscribed event to the publisher', async () => {
    const recorded = { id: 1n } as EventRecordedEvent;
    const started = { sessionId: 1n } as SessionStartedEvent;
    const ended = { sessionId: 2n } as SessionEndedEvent;
    const tracked = { characterId: 3n } as CharacterTrackedEvent;

    await listener.onEventRecorded(recorded);
    await listener.onSessionStarted(started);
    await listener.onSessionEnded(ended);
    await listener.onCharacterTracked(tracked);

    expect(publisher.onEventRecorded).toHaveBeenCalledWith(recorded);
    expect(publisher.onSessionStarted).toHaveBeenCalledWith(started);
    expect(publisher.onSessionEnded).toHaveBeenCalledWith(ended);
    expect(publisher.onCharacterTracked).toHaveBeenCalledWith(tracked);
  });

  it('never throws, even when the database fails', async () => {
    publisher.onEventRecorded.mockRejectedValue(new Error('db down'));

    await expect(listener.onEventRecorded({ id: 1n } as EventRecordedEvent)).resolves.toBeUndefined();
  });
});
