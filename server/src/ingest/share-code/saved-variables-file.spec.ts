import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractValidator, findContractDir } from '../../common/contract/contract-validator';
import { MAX_SOURCE_BYTES } from '../../common/lua';
import { readSavedVariablesFile } from './saved-variables-file';

const contract = new ContractValidator();
const dir = join(findContractDir(), 'fixtures', 'savedvariables');
const fixture = (name: string) => readFileSync(join(dir, name));
const NOW_SEC = 1_793_901_000;

describe('readSavedVariablesFile', () => {
  it('turns a valid ForeverTracker.lua into a sync request holding every character', () => {
    const result = readSavedVariablesFile(fixture('ForeverTracker.sample.lua'), contract, NOW_SEC);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sentAt).toBe(NOW_SEC);
    expect(result.payload.schema).toBe(1);
    expect(result.payload.addonVersion).toBe('0.1.0');
    expect(result.payload.characters.map((c) => `${c.key.firstName} ${c.key.surname}`)).toEqual([
      'Davina Asaria',
      expect.stringMatching(/^Morwen /),
    ]);
    expect(contract.validate('sync.request', result.payload)).toEqual({ ok: true });
  });

  it('refuses a trapped file as not_literal, without running it', () => {
    expect(readSavedVariablesFile(fixture('ForeverTracker.malicious.lua'), contract, NOW_SEC)).toEqual({
      ok: false,
      reason: 'not_literal',
    });
  });

  it('refuses a file that is not Lua as lua_syntax', () => {
    expect(readSavedVariablesFile(Buffer.from('ForeverTrackerDB = {'), contract, NOW_SEC)).toEqual({
      ok: false,
      reason: 'lua_syntax',
    });
  });

  it('refuses a file over 512 KiB as too_large', () => {
    const big = Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x20);

    expect(readSavedVariablesFile(big, contract, NOW_SEC)).toEqual({ ok: false, reason: 'too_large' });
  });

  it.each([
    ['ForeverTrackerDB = nil', fixture('ForeverTracker.empty.lua')],
    ['no character', Buffer.from('ForeverTrackerDB = { ["schema"] = 1, ["addonVersion"] = "0.1.0", ["characters"] = {} }')],
    ['another global only', Buffer.from('SomethingElseDB = { ["a"] = 1 }')],
  ])('answers empty for %s', (_label, source) => {
    expect(readSavedVariablesFile(source, contract, NOW_SEC)).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses another schema version as unknown_schema', () => {
    const source = fixture('ForeverTracker.sample.lua').toString('utf8').replace('["schema"] = 1', '["schema"] = 2');

    expect(readSavedVariablesFile(Buffer.from(source), contract, NOW_SEC)).toEqual({ ok: false, reason: 'unknown_schema' });
  });

  it('refuses a file that breaks sync.request.json, naming the field', () => {
    const source = fixture('ForeverTracker.sample.lua').toString('utf8').replace('["level"] = 23', '["level"] = 99');

    expect(readSavedVariablesFile(Buffer.from(source), contract, NOW_SEC)).toEqual({
      ok: false,
      reason: 'invalid',
      detail: '/characters/0/snapshot/level',
    });
  });
});
