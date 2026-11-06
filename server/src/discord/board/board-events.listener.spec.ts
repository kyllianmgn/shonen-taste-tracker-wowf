import type { CharacterUpdatedEvent } from '../../ingest/sync/sync.events';
import type { SessionEndedEvent, SessionStartedEvent } from '../../presence/presence.events';
import { BoardEventsListener } from './board-events.listener';
import type { BoardPublisher } from './board-publisher';

describe('BoardEventsListener', () => {
  let publisher: { markPlayerDirty: jest.Mock };
  let listener: BoardEventsListener;

  beforeEach(() => {
    publisher = { markPlayerDirty: jest.fn().mockResolvedValue(undefined) };
    listener = new BoardEventsListener(publisher as unknown as BoardPublisher);
  });

  function characterUpdated(role: CharacterUpdatedEvent['role']): CharacterUpdatedEvent {
    return { characterId: 1n, ownerId: 'u1', role, snapshotId: 2n, level: 12, source: 'app', flags: [] };
  }

  it.each(['main', 'alt'] as const)('marks the guilds of the owner of an updated %s', async (role) => {
    await listener.onCharacterUpdated(characterUpdated(role));

    expect(publisher.markPlayerDirty).toHaveBeenCalledWith('u1');
  });

  it('ignores untracked characters, which the board never shows', async () => {
    await listener.onCharacterUpdated(characterUpdated('untracked'));

    expect(publisher.markPlayerDirty).not.toHaveBeenCalled();
  });

  it('marks the guilds of a player whose session started', async () => {
    await listener.onSessionStarted({ sessionId: 1n, ownerId: 'u2', characterId: null, startedAt: new Date() });

    expect(publisher.markPlayerDirty).toHaveBeenCalledWith('u2');
  });

  it('marks the guilds of a player whose session ended, quiet or not', async () => {
    await listener.onSessionEnded({ sessionId: 1n, ownerId: 'u4', quiet: true } as SessionEndedEvent);

    expect(publisher.markPlayerDirty).toHaveBeenCalledWith('u4');
  });

  it('never throws, even when the lookup fails', async () => {
    publisher.markPlayerDirty.mockRejectedValue(new Error('db down'));

    await expect(listener.onSessionStarted({ ownerId: 'u3' } as SessionStartedEvent)).resolves.toBeUndefined();
  });
});
