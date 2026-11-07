import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ApiError } from '../src/api.js';
import { parseScenario, runScenario } from '../src/scenario.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = resolve(here, '../../../contract/fixtures/scenarios');

function harness(fixtures = {}, { failOnce } = {}) {
  let now = 1_000_000;
  const calls = [];
  const sleeps = [];
  const lines = [];
  let failed = false;
  const respond = (kind, body) => {
    calls.push({ kind, body, at: now });
    if (failOnce === kind && !failed) {
      failed = true;
      throw new ApiError({ status: 429, code: 'rate_limited', message: 'Trop de requêtes', retryAfterSec: 7 });
    }
    return kind === 'sync'
      ? { results: [{ status: 'ok', acceptedEvents: 1, duplicateEvents: 0, flags: [] }] }
      : { heartbeatIntervalSec: 600, serverTime: now };
  };
  return {
    calls,
    sleeps,
    lines,
    deps: {
      api: {
        heartbeat: async (body) => respond('heartbeat', body),
        sync: async (body) => respond('sync', body),
      },
      baseDir: '/scen',
      loadJson: (path) => {
        if (!(path in fixtures)) throw new Error(`no fixture ${path}`);
        return structuredClone(fixtures[path]);
      },
      nowSec: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms / 1000;
      },
      log: (line) => lines.push(line),
    },
  };
}

const HB = { sentAt: 50, gameRunning: true, appVersion: '0.1.0' };
const SYNC = { sentAt: 100, schema: 1, characters: [{ snapshot: { capturedAt: 90 }, events: [{ id: 'e', at: 80 }] }] };

describe('parseScenario', () => {
  it('accepts a list of steps', () => {
    const steps = parseScenario([
      { action: 'heartbeat', gameRunning: true, waitSec: 2 },
      { action: 'sync', fixture: 'a.json' },
    ]);
    assert.equal(steps.length, 2);
  });

  const invalid = [
    ['a non-array', { steps: [] }, /liste/],
    ['an empty list', [], /liste/],
    ['an unknown action', [{ action: 'jump' }], /étape 1.*action/],
    ['a sync without fixture', [{ action: 'sync' }], /étape 1.*fixture/],
    ['a heartbeat with neither gameRunning nor fixture', [{ action: 'heartbeat' }], /étape 1.*gameRunning/],
    ['a negative waitSec', [{ action: 'wait', waitSec: -1 }], /étape 1.*waitSec/],
    ['a wait without waitSec', [{ action: 'wait' }], /étape 1.*waitSec/],
    ['a non-numeric offsetSec', [{ action: 'sync', fixture: 'a', offsetSec: '5' }], /étape 1.*offsetSec/],
    ['an unknown field', [{ action: 'sync', fixture: 'a', foo: 1 }], /étape 1.*foo/],
  ];
  for (const [label, input, message] of invalid) {
    it(`rejects ${label}`, () => assert.throws(() => parseScenario(input), message));
  }
});

describe('runScenario', () => {
  it('runs the steps in order, retimed to now, waiting waitSec after each', async () => {
    const h = harness({ [resolve('/scen', 'hb.json')]: HB, [resolve('/scen', 's.json')]: SYNC });

    await runScenario(
      parseScenario([
        { action: 'heartbeat', fixture: 'hb.json', gameRunning: true, waitSec: 2 },
        { action: 'sync', fixture: 's.json', offsetSec: -5, waitSec: 3 },
        { action: 'wait', waitSec: 1 },
        { action: 'heartbeat', gameRunning: false },
      ]),
      h.deps,
    );

    assert.deepEqual(h.sleeps, [2000, 3000, 1000]);
    assert.deepEqual(
      h.calls.map((c) => c.kind),
      ['heartbeat', 'sync', 'heartbeat'],
    );
    assert.deepEqual(h.calls[0].body, { ...HB, sentAt: 1_000_000 });
    assert.equal(h.calls[1].body.sentAt, 1_000_002 - 5);
    assert.equal(h.calls[1].body.characters[0].snapshot.capturedAt, 1_000_002 - 15);
    // A heartbeat without fixture is built from scratch.
    assert.deepEqual(h.calls[2].body, { sentAt: 1_000_006, gameRunning: false, appVersion: '0.1.0' });
  });

  it('lets gameRunning override the fixture', async () => {
    const h = harness({ [resolve('/scen', 'hb.json')]: HB });

    await runScenario(parseScenario([{ action: 'heartbeat', fixture: 'hb.json', gameRunning: false }]), h.deps);

    assert.equal(h.calls[0].body.gameRunning, false);
  });

  it('waits Retry-After and retries once when rate limited', async () => {
    const h = harness({ [resolve('/scen', 's.json')]: SYNC }, { failOnce: 'sync' });

    await runScenario(parseScenario([{ action: 'sync', fixture: 's.json' }]), h.deps);

    assert.deepEqual(h.sleeps, [7000]);
    assert.equal(h.calls.length, 2);
    // The retry is retimed to its own sending time.
    assert.equal(h.calls[1].body.sentAt, 1_000_007);
  });

  it('logs one French line per step', async () => {
    const h = harness({ [resolve('/scen', 's.json')]: SYNC });

    await runScenario(
      parseScenario([
        { action: 'heartbeat', gameRunning: true },
        { action: 'sync', fixture: 's.json' },
      ]),
      h.deps,
    );

    assert.match(h.lines[0], /1\/2 .*heartbeat.*jeu lancé/);
    assert.match(h.lines[1], /2\/2 .*sync.*ok/);
  });
});

describe('contract/fixtures/scenarios/session-levelup.json', () => {
  const file = join(scenariosDir, 'session-levelup.json');
  const steps = parseScenario(JSON.parse(readFileSync(file, 'utf8')));

  it('launches the game, syncs, levels up, then stops the game', () => {
    assert.deepEqual(
      steps.map((s) => [s.action, s.gameRunning]),
      [
        ['heartbeat', true],
        ['sync', undefined],
        ['sync', undefined],
        ['heartbeat', false],
      ],
    );
  });

  it('sends one character that gains exactly one level, from a SESSION_START to a LEVEL_UP', async () => {
    const h = harness();
    h.deps.baseDir = scenariosDir;
    h.deps.loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

    await runScenario(steps, h.deps);

    const syncs = h.calls.filter((c) => c.kind === 'sync');
    const [login, levelUp] = syncs.map((c) => c.body.characters[0]);
    assert.equal(levelUp.snapshot.level - login.snapshot.level, 1);
    assert.deepEqual(
      login.events.map((e) => e.type),
      ['SESSION_START'],
    );
    assert.deepEqual(
      levelUp.events.map((e) => e.type),
      ['LEVEL_UP'],
    );
    assert.equal(levelUp.events[0].data.level, levelUp.snapshot.level);
    // Snapshots move forward and nothing is ahead of its own sending time.
    assert.ok(levelUp.snapshot.capturedAt > login.snapshot.capturedAt);
    for (const c of syncs) {
      const character = c.body.characters[0];
      assert.ok(character.snapshot.capturedAt <= c.at);
      for (const e of character.events) assert.ok(e.at <= c.at);
    }
    // 2 heartbeats and 2 syncs: within the server's 2 per minute per device and route.
    assert.equal(h.calls.length, 4);
  });
});
