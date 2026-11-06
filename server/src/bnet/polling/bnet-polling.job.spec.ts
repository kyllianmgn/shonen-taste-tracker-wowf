import type { BnetAccountPoller } from './bnet-account-poller.service';
import { BNET_POLL_INTERVAL_MS, BnetPollingJob } from './bnet-polling.job';

describe('BnetPollingJob', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const job = (pollAll: jest.Mock) => new BnetPollingJob({ pollAll } as unknown as BnetAccountPoller);

  it('polls every 10 minutes once the application has started, and stops on shutdown', async () => {
    expect(BNET_POLL_INTERVAL_MS).toBe(10 * 60_000);
    const pollAll = jest.fn().mockResolvedValue(undefined);
    const j = job(pollAll);

    j.onApplicationBootstrap();
    expect(pollAll).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(2);

    j.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3 * BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(2);
  });

  it('never starts a pass while the previous one is still running', async () => {
    let finish!: () => void;
    const pollAll = jest.fn().mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const j = job(pollAll);

    j.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3 * BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(1);

    finish();
    pollAll.mockResolvedValue(undefined);
    await jest.advanceTimersByTimeAsync(BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(2);
    j.onModuleDestroy();
  });

  it('survives a failing pass', async () => {
    const pollAll = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    const j = job(pollAll);

    j.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2 * BNET_POLL_INTERVAL_MS);
    expect(pollAll).toHaveBeenCalledTimes(2);
    j.onModuleDestroy();
  });
});
