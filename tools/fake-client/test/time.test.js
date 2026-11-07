import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { retime } from '../src/time.js';

const T0 = 1_793_900_000;
const sync = () => ({
  sentAt: T0,
  schema: 1,
  characters: [
    {
      key: { guid: 'Player-4242-0A1B2C3D' },
      snapshot: { capturedAt: T0 - 10, level: 23 },
      events: [
        { id: `Player-4242-0A1B2C3D-${T0 - 1000}-1`, type: 'SESSION_START', at: T0 - 1000, data: { at: 5 } },
        { id: 'custom-id', type: 'LEVEL_UP', at: T0 - 200, data: {} },
      ],
    },
  ],
});

describe('retime', () => {
  it('moves sentAt to now and keeps every other timestamp at the same distance from it', () => {
    const out = retime(sync(), { nowSec: 2_000_000_000 });

    assert.equal(out.sentAt, 2_000_000_000);
    assert.equal(out.characters[0].snapshot.capturedAt, 2_000_000_000 - 10);
    assert.deepEqual(
      out.characters[0].events.map((e) => e.at),
      [2_000_000_000 - 1000, 2_000_000_000 - 200],
    );
  });

  it('applies offsetSec: sentAt lands offsetSec seconds from now', () => {
    const out = retime(sync(), { nowSec: 2_000_000_000, offsetSec: -60 });

    assert.equal(out.sentAt, 2_000_000_000 - 60);
    assert.equal(out.characters[0].snapshot.capturedAt, 2_000_000_000 - 70);
  });

  it('rewrites the time inside addon-style event ids so a replay is not a duplicate', () => {
    const out = retime(sync(), { nowSec: 2_000_000_000 });

    assert.equal(out.characters[0].events[0].id, `Player-4242-0A1B2C3D-${2_000_000_000 - 1000}-1`);
    assert.equal(out.characters[0].events[1].id, 'custom-id');
  });

  it('leaves event data alone and does not mutate its input', () => {
    const input = sync();
    const out = retime(input, { nowSec: 2_000_000_000 });

    assert.deepEqual(out.characters[0].events[0].data, { at: 5 });
    assert.deepEqual(input, sync());
  });

  it('handles a heartbeat payload (sentAt only)', () => {
    const out = retime({ sentAt: T0, gameRunning: true, appVersion: '0.1.0' }, { nowSec: 1 });

    assert.deepEqual(out, { sentAt: 1, gameRunning: true, appVersion: '0.1.0' });
  });

  it('rejects a payload without a numeric sentAt', () => {
    assert.throws(() => retime({ gameRunning: true }, { nowSec: 1 }), /sentAt/);
  });
});
