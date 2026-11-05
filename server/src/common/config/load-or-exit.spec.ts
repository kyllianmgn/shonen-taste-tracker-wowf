import { loadConfigOrExit } from './load-or-exit';

describe('loadConfigOrExit', () => {
  it('prints the problems and exits with code 1 on an invalid configuration', () => {
    const exit = jest.fn((code: number): never => {
      throw new Error(`exited ${code}`);
    });
    const print = jest.fn<void, [string]>();

    expect(() => loadConfigOrExit({}, { exit, print })).toThrow('exited 1');

    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0][0]).toContain('DISCORD_TOKEN is required');
  });

  it('rethrows unexpected errors instead of hiding them', () => {
    const env = new Proxy(
      {},
      {
        get: () => {
          throw new TypeError('boom');
        },
      },
    );
    const exit = jest.fn((): never => {
      throw new Error('should not exit');
    });

    expect(() => loadConfigOrExit(env, { exit, print: jest.fn() })).toThrow('boom');
  });
});
