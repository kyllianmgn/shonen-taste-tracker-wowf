import type { CharacterUpdatedEvent } from '../../ingest/sync/sync.events';
import { BoardEventsListener } from './board-events.listener';
import type { BoardPublisher } from './board-publisher';

describe('BoardEventsListener', () => {
  let publisher: { markPlayerDirty: jest.Mock; markAllDirty: jest.Mock };
  let listener: BoardEventsListener;

  beforeEach(() => {
    publisher = { markPlayerDirty: jest.fn().mockResolvedValue(undefined), markAllDirty: jest.fn() };
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

  it.each(['onSessionStarted', 'onSessionEnded'] as const)('%s marks the guilds of the session owner', async (method) => {
    await listener[method]({ ownerId: 'u2' });

    expect(publisher.markPlayerDirty).toHaveBeenCalledWith('u2');
  });

  it('marks every board when a session event has no owner', async () => {
    await listener.onSessionEnded({});

    expect(publisher.markAllDirty).toHaveBeenCalled();
  });

  it('never throws, even when the lookup fails', async () => {
    publisher.markPlayerDirty.mockRejectedValue(new Error('db down'));

    await expect(listener.onSessionStarted({ ownerId: 'u3' })).resolves.toBeUndefined();
  });
});
