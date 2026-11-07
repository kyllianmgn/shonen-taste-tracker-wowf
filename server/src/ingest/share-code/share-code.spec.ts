import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ContractValidator, findContractDir } from '../../common/contract/contract-validator';
import { SHARE_CODE_MAX_JSON_BYTES, decodeShareCode, toSyncRequest } from './share-code';

const contract = new ContractValidator();
const sample = readFileSync(join(findContractDir(), 'fixtures', 'share-code.sample.txt'), 'utf8');

/** Encodes like the addon (docs/01 « Mode de base : /ftr share »): FT1: + base64url(deflateRaw(json)). */
const encode = (json: string | Buffer) => `FT1:${deflateRawSync(json, { level: 9 }).toString('base64url')}`;
const payload = () => {
  const result = decodeShareCode(sample, contract);
  if (!result.ok) throw new Error(`sample must decode: ${result.reason}`);
  return result.payload;
};

describe('decodeShareCode', () => {
  it('reads contract/fixtures/share-code.sample.txt (produced by the addon) without modification', () => {
    const result = decodeShareCode(sample, contract);

    expect(result.ok).toBe(true);
    const p = payload();
    expect(p.schema).toBe(1);
    expect(p.addonVersion).toBe('1.0.0');
    expect(p.character.key).toEqual({
      region: 'eu',
      firstName: 'Davina',
      surname: 'Asaria',
      guid: 'Player-4242-0A1B2C3D',
      realmName: 'CAMWOW EU5 Realm 1 PvE',
    });
    expect(p.character.snapshot).toMatchObject({ capturedAt: 1793901260, level: 24, guild: 'Les Éveillés' });
    expect(p.character.snapshot.subZone).toBe('L\'Éperon "sud"');
    expect(p.character.events.map((e) => e.type)).toEqual(['SESSION_START', 'DEATH', 'LEVEL_UP']);
  });

  it('accepts surrounding spaces and line breaks from a copy-paste', () => {
    expect(decodeShareCode(`  \n${sample.trim()}\r\n `, contract).ok).toBe(true);
  });

  it.each([
    ['empty text', ''],
    ['no FT1: prefix', sample.trim().slice(4)],
    ['an unknown version prefix', `FT2:${sample.trim().slice(4)}`],
    ['characters outside base64url', `${sample.trim()}+/=`],
    ['spaces inside the code', `${sample.trim().slice(0, 100)} ${sample.trim().slice(100)}`],
  ])('refuses %s as code_format', (_label, text) => {
    expect(decodeShareCode(text, contract)).toEqual({ ok: false, reason: 'code_format' });
  });

  it.each([
    ['a truncated code', sample.trim().slice(0, 300)],
    ['bytes that are not deflate', `FT1:${Buffer.from('hello world, not deflate').toString('base64url')}`],
    ['deflate of something that is not JSON', encode('not json {')],
    ['a JSON value that is not an object', encode('[1, 2, 3]')],
  ])('refuses %s as code_corrupt', (_label, text) => {
    expect(decodeShareCode(text, contract)).toEqual({ ok: false, reason: 'code_corrupt' });
  });

  it('refuses a deflate bomb without inflating it all', () => {
    const bomb = encode(Buffer.alloc(SHARE_CODE_MAX_JSON_BYTES + 1, 0x20));

    expect(decodeShareCode(bomb, contract)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses another schema version as unknown_schema', () => {
    const p = { ...payload(), schema: 2 };

    expect(decodeShareCode(encode(JSON.stringify(p)), contract)).toEqual({ ok: false, reason: 'unknown_schema' });
  });

  it('refuses a payload that breaks share-code.payload.json, naming the field', () => {
    const p = payload();
    const broken = { ...p, character: { ...p.character, snapshot: { ...p.character.snapshot, level: 61 } } };

    expect(decodeShareCode(encode(JSON.stringify(broken)), contract)).toEqual({
      ok: false,
      reason: 'invalid',
      detail: '/character/snapshot/level',
    });
  });

  it('refuses fields outside the schema (additionalProperties: false)', () => {
    const result = decodeShareCode(encode(JSON.stringify({ ...payload(), characters: [] })), contract);

    expect(result).toEqual({ ok: false, reason: 'invalid', detail: '/characters' });
  });
});

describe('toSyncRequest', () => {
  it('wraps the single character as a sync request', () => {
    const p = payload();

    expect(toSyncRequest(p)).toEqual({
      sentAt: p.sentAt,
      schema: 1,
      addonVersion: '1.0.0',
      characters: [p.character],
    });
    expect(contract.validate('sync.request', toSyncRequest(p))).toEqual({ ok: true });
  });
});
