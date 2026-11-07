import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../src/api.js';
import { main } from '../src/cli.js';

/** Paths built with node:path on Windows, compared as POSIX. */
const posix = (p) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');

function harness({ token = 'saved-token' } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const saved = [];
  const deps = {
    env: { API_BASE_URL: 'http://srv:1234' },
    tokenFile: '/x/.token',
    defaultFixturesDir: '/contract/fixtures',
    cwd: '/work',
    createApi: (opts) => {
      calls.push({ kind: 'createApi', opts });
      return {
        pair: async (body) => {
          calls.push({ kind: 'pair', body });
          return { deviceId: 'dev-1', deviceToken: 'secret-token', heartbeatIntervalSec: 600 };
        },
        heartbeat: async (body) => {
          calls.push({ kind: 'heartbeat', body });
          return { heartbeatIntervalSec: 600, serverTime: 1 };
        },
        sync: async (body) => {
          calls.push({ kind: 'sync', body });
          return { results: [{ status: 'ok', acceptedEvents: 2, duplicateEvents: 0, flags: [] }] };
        },
      };
    },
    readToken: () => token,
    writeToken: (file, value) => saved.push({ file, value }),
    loadJson: () => {
      throw new Error('unexpected read');
    },
    nowSec: () => 5000,
    sleep: async () => {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { deps, out, err, calls, saved };
}

describe('cli', () => {
  it('pair: normalizes the code, saves the token, never prints it', async () => {
    const t = harness({ token: null });

    const code = await main(['pair', 'abcd-efgh'], t.deps);

    assert.equal(code, 0);
    assert.equal(t.calls[0].opts.baseUrl, 'http://srv:1234');
    assert.deepEqual(t.calls[1].body, { code: 'ABCDEFGH', deviceName: 'fake-client', appVersion: '0.1.0', os: 'windows' });
    assert.deepEqual(t.saved, [{ file: '/x/.token', value: 'secret-token' }]);
    assert.ok(!t.out.join('\n').includes('secret-token'));
    assert.match(t.out.join('\n'), /dev-1/);
  });

  it('pair needs a code', async () => {
    const t = harness();

    assert.equal(await main(['pair'], t.deps), 2);
  });

  it('defaults API_BASE_URL to http://localhost:3000 and uses the saved token', async () => {
    const t = harness();
    t.deps.env = {};
    t.deps.loadJson = () => ({ sentAt: 1, gameRunning: true, appVersion: '0.1.0' });

    await main(['heartbeat', '--running'], t.deps);

    assert.equal(t.calls[0].opts.baseUrl, 'http://localhost:3000');
    assert.equal(t.calls[0].opts.token, 'saved-token');
  });

  it('heartbeat --running / --stopped send the matching contract fixture, retimed to now', async () => {
    const running = { sentAt: 1, gameRunning: true, appVersion: '0.1.0' };
    const stopped = { sentAt: 2, gameRunning: false, appVersion: '0.1.0' };
    const t = harness();
    const read = [];
    t.deps.loadJson = (path) => {
      read.push(posix(path));
      return structuredClone(posix(path).endsWith('heartbeat.running.json') ? running : stopped);
    };

    await main(['heartbeat', '--running'], t.deps);
    await main(['heartbeat', '--stopped'], t.deps);

    assert.deepEqual(read, ['/contract/fixtures/heartbeat.running.json', '/contract/fixtures/heartbeat.stopped.json']);
    const beats = t.calls.filter((c) => c.kind === 'heartbeat').map((c) => c.body);
    assert.deepEqual(beats, [
      { ...running, sentAt: 5000 },
      { ...stopped, sentAt: 5000 },
    ]);
  });

  it('heartbeat needs exactly one of --running and --stopped', async () => {
    const t = harness();

    assert.equal(await main(['heartbeat'], t.deps), 2);
    assert.equal(await main(['heartbeat', '--running', '--stopped'], t.deps), 2);
    assert.match(t.err.join('\n'), /--running/);
  });

  it('sync --fixture resolves the file from the current directory and applies --offset-sec', async () => {
    const t = harness();
    t.deps.loadJson = (path) => {
      assert.equal(posix(path), '/work/contract/fixtures/sync.valid.json');
      return { sentAt: 100, characters: [] };
    };

    const code = await main(['sync', '--fixture', 'contract/fixtures/sync.valid.json', '--offset-sec', '-30'], t.deps);

    assert.equal(code, 0);
    assert.deepEqual(t.calls.at(-1).body, { sentAt: 4970, characters: [] });
    assert.match(t.out.join('\n'), /ok/);
  });

  it('sync needs --fixture, and --offset-sec must be an integer', async () => {
    const t = harness();

    assert.equal(await main(['sync'], t.deps), 2);
    assert.equal(await main(['sync', '--fixture', 'f.json', '--offset-sec', 'abc'], t.deps), 2);
  });

  it('accepts the short form `--fixture <file>` as a sync', async () => {
    const t = harness();
    t.deps.loadJson = () => ({ sentAt: 100, characters: [] });

    assert.equal(await main(['--fixture', 'f.json'], t.deps), 0);
    assert.equal(t.calls.at(-1).kind, 'sync');
  });

  it('refuses heartbeat and sync before pairing', async () => {
    const t = harness({ token: null });

    assert.equal(await main(['heartbeat', '--running'], t.deps), 1);
    assert.match(t.err.join('\n'), /pair/);
  });

  it('scenario runs the file with fixtures relative to it', async () => {
    const t = harness();
    t.deps.loadJson = (path) => {
      const p = posix(path);
      if (p === '/work/scen/s.json') return [{ action: 'sync', fixture: 'p.json' }];
      if (p === '/work/scen/p.json') return { sentAt: 1, characters: [] };
      throw new Error(p);
    };

    assert.equal(await main(['scenario', 'scen/s.json'], t.deps), 0);
    assert.equal(t.calls.at(-1).kind, 'sync');
  });

  it('prints the usage and fails on an unknown command', async () => {
    const t = harness();

    assert.equal(await main(['dance'], t.deps), 2);
    assert.match(t.err.join('\n'), /Usage/);
  });

  it('reports an API error on stderr with exit code 1', async () => {
    const t = harness();
    t.deps.createApi = () => ({
      heartbeat: async () => {
        throw new ApiError({ status: 401, code: 'invalid_token', message: 'Jeton invalide' });
      },
    });
    t.deps.loadJson = () => ({ sentAt: 1, gameRunning: true, appVersion: '0.1.0' });

    assert.equal(await main(['heartbeat', '--running'], t.deps), 1);
    assert.match(t.err.join('\n'), /invalid_token/);
  });
});
