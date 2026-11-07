import { Logger } from '@nestjs/common';
import type { PlayerAccountService } from '../core/players/player-account.service';
import { OrphanCleanupJob } from './orphan-cleanup.job';

describe('OrphanCleanupJob', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs hourly', () => {
    expect(OrphanCleanupJob.INTERVAL_MS).toBe(3_600_000);
  });

  it('deletes the orphan characters', async () => {
    const deleteOrphanCharacters = jest.fn().mockResolvedValue(2);
    const job = new OrphanCleanupJob({ deleteOrphanCharacters } as unknown as PlayerAccountService);

    await job.run();

    expect(deleteOrphanCharacters).toHaveBeenCalledTimes(1);
  });

  it('never throws', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = new OrphanCleanupJob({
      deleteOrphanCharacters: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PlayerAccountService);

    await expect(job.run()).resolves.toBeUndefined();
  });
});
