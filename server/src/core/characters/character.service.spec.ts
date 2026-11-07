import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { CHARACTER_EVENTS } from './character.events';
import { CharacterService } from './character.service';

/**
 * Only the character.tracked emission is covered here; the ownership rules themselves run against
 * PostgreSQL in test/character.service.e2e-spec.ts.
 */
describe('CharacterService character.tracked', () => {
  const OWNER = 'u1';
  const davina = { id: 7n, region: 'eu', firstName: 'Davina', surname: 'Asaria', ownerId: OWNER, bnetVerified: false };

  let identity: object[];
  let target: object | null;
  let tracked: object[];
  let emitter: { emit: jest.Mock };
  let service: CharacterService;

  beforeEach(() => {
    identity = [];
    target = null;
    tracked = [];
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join('?').includes('lower(first_name)') ? identity : []),
      ),
      character: {
        findFirst: jest.fn(() => Promise.resolve(target)),
        findMany: jest.fn(() => Promise.resolve(tracked)),
        create: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...davina, ...data })),
        update: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...davina, ...data })),
      },
      snapshot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: jest.fn((run: (t: typeof tx) => unknown) => run(tx)) };
    emitter = { emit: jest.fn() };
    service = new CharacterService(prisma as unknown as PrismaService, emitter as unknown as EventEmitter2);
  });

  const trackedEvent = (role: 'main' | 'alt') => ({ characterId: 7n, ownerId: OWNER, role, firstName: 'Davina', surname: 'Asaria' });

  it('emits when /perso ajouter creates a character', async () => {
    const result = await service.add({ ownerId: OWNER, guildId: 'g1', region: 'eu', firstName: 'davina', surname: 'asaria' });

    expect(result.status).toBe('added');
    expect(emitter.emit).toHaveBeenCalledWith(CHARACTER_EVENTS.tracked, trackedEvent('main'));
  });

  it('emits when /perso ajouter takes back an untracked character', async () => {
    identity = [{ ...davina, role: 'untracked' }];

    await service.add({ ownerId: OWNER, guildId: 'g1', region: 'eu', firstName: 'Davina', surname: 'Asaria', role: 'alt' });

    expect(emitter.emit).toHaveBeenCalledWith(CHARACTER_EVENTS.tracked, trackedEvent('alt'));
  });

  it('does not emit for a character already tracked or refused', async () => {
    identity = [{ ...davina, role: 'main' }];
    await service.add({ ownerId: OWNER, guildId: 'g1', region: 'eu', firstName: 'Davina', surname: 'Asaria' });
    identity = [{ ...davina, ownerId: 'other', role: 'main' }];
    await service.add({ ownerId: OWNER, guildId: 'g1', region: 'eu', firstName: 'Davina', surname: 'Asaria' });

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('emits when an untracked character becomes main or alt', async () => {
    target = { ...davina, role: 'untracked' };

    await service.setMain(OWNER, 7n);
    await service.setAlt(OWNER, 7n);

    expect(emitter.emit.mock.calls).toEqual([
      [CHARACTER_EVENTS.tracked, trackedEvent('main')],
      [CHARACTER_EVENTS.tracked, trackedEvent('alt')],
    ]);
  });

  it('does not emit when main and alt only swap', async () => {
    target = { ...davina, role: 'alt' };

    const result = await service.setMain(OWNER, 7n);

    expect(result.status).toBe('promoted');
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('works without an emitter', async () => {
    const prisma = { $transaction: jest.fn().mockResolvedValue({ status: 'not_found' }) };
    const bare = new CharacterService(prisma as unknown as PrismaService);

    await expect(bare.setMain(OWNER, 7n)).resolves.toEqual({ status: 'not_found' });
  });
});
