import type { BoardPublisher } from '../discord/board/board-publisher';
import { BOARD_TICK_MS, BoardRedrawJob } from './board-redraw.job';

describe('BoardRedrawJob', () => {
  let publisher: { markAllDirty: jest.Mock; tick: jest.Mock };
  let job: BoardRedrawJob;

  beforeEach(() => {
    jest.useFakeTimers();
    publisher = { markAllDirty: jest.fn(), tick: jest.fn().mockResolvedValue(undefined) };
    job = new BoardRedrawJob(publisher as unknown as BoardPublisher);
  });

  afterEach(async () => {
    await job.onModuleDestroy();
    jest.useRealTimers();
  });

  it('ticks every 5 s', () => {
    expect(BOARD_TICK_MS).toBe(5000);
  });

  it('redraws every board at startup, then ticks every 5 s', () => {
    job.onApplicationBootstrap();

    expect(publisher.markAllDirty).toHaveBeenCalledTimes(1);
    expect(publisher.tick).not.toHaveBeenCalled();

    jest.advanceTimersByTime(BOARD_TICK_MS);
    expect(publisher.tick).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2 * BOARD_TICK_MS);
    expect(publisher.tick).toHaveBeenCalledTimes(3);
  });

  it('stops ticking when the module is destroyed', async () => {
    job.onApplicationBootstrap();

    await job.onModuleDestroy();
    jest.advanceTimersByTime(3 * BOARD_TICK_MS);

    expect(publisher.tick).not.toHaveBeenCalled();
  });

  it('waits for a running tick before shutting down', async () => {
    let finish!: () => void;
    publisher.tick.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    job.onApplicationBootstrap();
    jest.advanceTimersByTime(BOARD_TICK_MS);

    let destroyed = false;
    const destroying = job.onModuleDestroy().then(() => (destroyed = true));
    await Promise.resolve();
    expect(destroyed).toBe(false);

    finish();
    await destroying;
    expect(destroyed).toBe(true);
  });
});
