import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthRegistry } from './health.registry';

const dbUp = () => ({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }) as unknown as PrismaService;
const dbDown = () => ({ $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }) as unknown as PrismaService;

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    return (e as ServiceUnavailableException).getResponse();
  }
  throw new Error('expected a 503');
}

describe('HealthController', () => {
  it('answers ok when the database responds and nothing else is registered', async () => {
    const controller = new HealthController(dbUp(), new HealthRegistry());

    await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('reports the database down with 503', async () => {
    const controller = new HealthController(dbDown(), new HealthRegistry());

    await expect(failure(controller.check())).resolves.toEqual({ status: 'error', database: 'down' });
  });

  it('includes registered checks, such as the Discord connection', async () => {
    const registry = new HealthRegistry();
    registry.register('discord', () => true);
    const controller = new HealthController(dbUp(), registry);

    await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up', discord: 'up' });
  });

  it('answers 503 when a registered check is down or throws', async () => {
    const registry = new HealthRegistry();
    registry.register('discord', () => false);
    registry.register('other', () => Promise.reject(new Error('boom')));
    const controller = new HealthController(dbUp(), registry);

    await expect(failure(controller.check())).resolves.toEqual({
      status: 'error',
      database: 'up',
      discord: 'down',
      other: 'down',
    });
  });

  it('refuses to register the same check twice', () => {
    const registry = new HealthRegistry();
    registry.register('discord', () => true);
    expect(() => registry.register('discord', () => true)).toThrow(/discord/);
  });
});
