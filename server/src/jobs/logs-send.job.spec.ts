import type { LogsPublisher } from '../discord/logs/logs-publisher';
import { LOGS_TICK_MS, LogsSendJob } from './logs-send.job';

describe('LogsSendJob', () => {
  let publisher: { tick: jest.Mock; flush: jest.Mock };
  let job: LogsSendJob;

  beforeEach(() => {
    jest.useFakeTimers();
    publisher = { tick: jest.fn().mockResolvedValue(undefined), flush: jest.fn().mockResolvedValue(undefined) };
    job = new LogsSendJob(publisher as unknown as LogsPublisher);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ticks every 500 ms, often enough for the 1.5 s pace', () => {
    expect(LOGS_TICK_MS).toBe(500);
    job.onApplicationBootstrap();

    jest.advanceTimersByTime(3 * LOGS_TICK_MS);

    expect(publisher.tick).toHaveBeenCalledTimes(3);
  });

  it('stops ticking and sends what is waiting when the module is destroyed', async () => {
    job.onApplicationBootstrap();

    await job.onModuleDestroy();
    jest.advanceTimersByTime(3 * LOGS_TICK_MS);

    expect(publisher.tick).not.toHaveBeenCalled();
    expect(publisher.flush).toHaveBeenCalledTimes(1);
  });
});
