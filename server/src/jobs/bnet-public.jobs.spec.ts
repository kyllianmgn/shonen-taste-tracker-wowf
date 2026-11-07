import type { BnetPublicPoller } from '../bnet/public/bnet-public-poller.service';
import type { PublicProfileProbe } from '../bnet/public/public-profile-probe.service';
import { BNET_PUBLIC_POLL_TICK_MS, BnetPublicPollJob } from './bnet-public-poll.job';
import { BNET_PUBLIC_PROBE_INTERVAL_MS, BnetPublicProbeJob } from './bnet-public-probe.job';

describe('BnetPublicProbeJob', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tests the public profile at startup, then once a day, until shutdown', async () => {
    expect(BNET_PUBLIC_PROBE_INTERVAL_MS).toBe(24 * 3_600_000);
    const run = jest.fn().mockResolvedValue('closed');
    const job = new BnetPublicProbeJob({ run } as unknown as PublicProfileProbe);

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(BNET_PUBLIC_PROBE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);

    job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3 * BNET_PUBLIC_PROBE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('survives a failing test', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue('open');
    const job = new BnetPublicProbeJob({ run } as unknown as PublicProfileProbe);

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BNET_PUBLIC_PROBE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    job.onModuleDestroy();
  });
});

describe('BnetPublicPollJob', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('looks for due characters every minute, never two passes at once', async () => {
    expect(BNET_PUBLIC_POLL_TICK_MS).toBe(60_000);
    let finish!: () => void;
    const pollDue = jest.fn().mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const job = new BnetPublicPollJob({ pollDue } as unknown as BnetPublicPoller);

    job.onApplicationBootstrap();
    expect(pollDue).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3 * BNET_PUBLIC_POLL_TICK_MS);
    expect(pollDue).toHaveBeenCalledTimes(1);

    finish();
    pollDue.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined);
    await jest.advanceTimersByTimeAsync(2 * BNET_PUBLIC_POLL_TICK_MS);
    expect(pollDue).toHaveBeenCalledTimes(3);

    job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3 * BNET_PUBLIC_POLL_TICK_MS);
    expect(pollDue).toHaveBeenCalledTimes(3);
  });
});
