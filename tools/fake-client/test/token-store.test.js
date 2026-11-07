import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { readToken, writeToken } from '../src/token-store.js';

const dir = mkdtempSync(join(tmpdir(), 'fake-client-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('token store', () => {
  it('returns null when no token was saved', () => {
    assert.equal(readToken(join(dir, 'missing')), null);
  });

  it('writes the token and reads it back, trimmed', () => {
    const file = join(dir, '.token');
    writeToken(file, 'abc');

    assert.equal(readFileSync(file, 'utf8').trim(), 'abc');
    assert.equal(readToken(file), 'abc');
  });
});
