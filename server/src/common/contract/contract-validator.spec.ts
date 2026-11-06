import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ContractValidator,
  SCHEMA_NAMES,
  findContractDir,
  type SchemaName,
  type ValidationResult,
} from './contract-validator';

const CONTRACT_DIR = findContractDir();
const FIXTURES_DIR = join(CONTRACT_DIR, 'fixtures');

/** Root-level JSON fixtures are named `<payload>.<variant>.json`; the prefix picks the schema. */
const FIXTURE_SCHEMAS: Record<string, SchemaName> = {
  sync: 'sync.request',
  heartbeat: 'heartbeat.request',
};

function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
}

interface SyncPayload {
  characters: Array<{
    key: Record<string, unknown>;
    snapshot: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
  }>;
}

function validSync(): SyncPayload {
  return readFixture('sync.valid.json') as SyncPayload;
}

function errorsOf(result: ValidationResult) {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

describe('ContractValidator', () => {
  const validator = new ContractValidator();

  it('loads every schema file from contract/schemas', () => {
    const files = readdirSync(join(CONTRACT_DIR, 'schemas'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();

    expect([...SCHEMA_NAMES].sort()).toEqual(files);
    expect(validator.schemaNames().sort()).toEqual(files);
  });

  it('hands out a raw schema as read from contract/schemas (Lua normalization needs it)', () => {
    const raw = JSON.parse(readFileSync(join(CONTRACT_DIR, 'schemas', 'sync.request.json'), 'utf8')) as unknown;

    expect(validator.schema('sync.request')).toEqual(raw);
  });

  const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));

  it('finds the JSON fixtures', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('accepts fixture %s', (file) => {
    const schema = FIXTURE_SCHEMAS[file.split('.')[0]];
    expect(schema).toBeDefined();

    expect(validator.validate(schema, readFixture(file))).toEqual({ ok: true });
  });

  it('rejects an unknown region', () => {
    const payload = validSync();
    payload.characters[0].key.region = 'fr';

    expect(errorsOf(validator.validate('sync.request', payload))).toEqual([
      { path: '/characters/0/key/region', message: 'must be one of: eu, us, kr, tw' },
    ]);
  });

  it('rejects level 61', () => {
    const payload = validSync();
    payload.characters[0].snapshot.level = 61;

    expect(errorsOf(validator.validate('sync.request', payload))).toEqual([
      { path: '/characters/0/snapshot/level', message: 'must be <= 60' },
    ]);
  });

  it('rejects an unknown field and points at it', () => {
    const payload = validSync();
    payload.characters[0].snapshot.speed = 7;

    expect(errorsOf(validator.validate('sync.request', payload))).toEqual([
      { path: '/characters/0/snapshot/speed', message: 'unknown field' },
    ]);
  });

  it('rejects an unknown event type', () => {
    const payload = validSync();
    payload.characters[0].events[1].type = 'TELEPORT';

    const errors = errorsOf(validator.validate('sync.request', payload));
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/characters/0/events/1/type');
    expect(errors[0].message).toMatch(/^must be one of: SESSION_START, /);
  });

  it('rejects 21 characters', () => {
    const payload = validSync();
    payload.characters = Array.from({ length: 21 }, () => validSync().characters[0]);

    expect(errorsOf(validator.validate('sync.request', payload))).toEqual([
      { path: '/characters', message: 'must NOT have more than 20 items' },
    ]);
  });

  it('accepts exactly 20 characters', () => {
    const payload = validSync();
    payload.characters = Array.from({ length: 20 }, () => validSync().characters[0]);

    expect(validator.validate('sync.request', payload)).toEqual({ ok: true });
  });

  it('reports a missing required field at its parent path', () => {
    const payload = validSync();
    delete payload.characters[0].snapshot.level;

    expect(errorsOf(validator.validate('sync.request', payload))).toEqual([
      { path: '/characters/0/snapshot/level', message: 'is required' },
    ]);
  });

  it('reports every problem at once', () => {
    const payload = validSync();
    payload.characters[0].key.region = 'fr';
    payload.characters[0].snapshot.level = 61;

    expect(errorsOf(validator.validate('sync.request', payload)).map((e) => e.path)).toEqual([
      '/characters/0/key/region',
      '/characters/0/snapshot/level',
    ]);
  });

  it('uses "/" as the path of a root-level error', () => {
    expect(errorsOf(validator.validate('sync.request', 'not an object'))).toEqual([
      { path: '/', message: 'must be object' },
    ]);
  });

  it('checks formats (uuid)', () => {
    const response = {
      deviceId: 'not-a-uuid',
      deviceToken: 'A'.repeat(43),
      heartbeatIntervalSec: 600,
    };

    expect(errorsOf(validator.validate('pair.response', response))).toEqual([
      { path: '/deviceId', message: 'must match format "uuid"' },
    ]);
    expect(
      validator.validate('pair.response', { ...response, deviceId: '6f1c2b0e-3d4a-4b5c-8d9e-0a1b2c3d4e5f' }),
    ).toEqual({ ok: true });
  });

  it('throws on an unknown schema name', () => {
    expect(() => validator.validate('nope' as SchemaName, {})).toThrow('Unknown contract schema "nope"');
  });

  it('fails fast when the contract directory has no schemas', () => {
    expect(() => new ContractValidator(join(CONTRACT_DIR, 'fixtures'))).toThrow(/schemas/);
  });
});
