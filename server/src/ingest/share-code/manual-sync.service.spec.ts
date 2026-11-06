import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractValidator, findContractDir } from '../../common/contract/contract-validator';
import { SlidingWindowLimiter } from '../auth/sliding-window-limiter';
import type { Clock } from '../clock';
import type { SyncService } from '../sync/sync.service';
import { MANUAL_SYNC_RATE_LIMIT, ManualSyncInputError, ManualSyncService } from './manual-sync.service';

const contract = new ContractValidator();
const fixtures = join(findContractDir(), 'fixtures');
const CODE = readFileSync(join(fixtures, 'share-code.sample.txt'), 'utf8');
const FILE = readFileSync(join(fixtures, 'savedvariables', 'ForeverTracker.sample.lua'));
const MALICIOUS = readFileSync(join(fixtures, 'savedvariables', 'ForeverTracker.malicious.lua'));
const T0_MS = 1_793_901_300_000;
const RESULTS = [{ key: { region: 'eu', firstName: 'Davina', surname: 'Asaria' }, status: 'ok', acceptedEvents: 3, duplicateEvents: 0, flags: [] }];

function setup() {
  let now = T0_MS;
  const clock: Clock = { now: () => now };
  const ingest = jest.fn().mockResolvedValue({ heartbeatIntervalSec: 600, results: RESULTS });
  const executeRaw = jest.fn().mockResolvedValue(1);
  const transaction = jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  const prisma = { $executeRaw: executeRaw, $transaction: transaction };
  const service = new ManualSyncService(
    { ingest } as unknown as SyncService,
    contract,
    prisma as never,
    new SlidingWindowLimiter(),
    clock,
  );
  return { service, ingest, executeRaw, advance: (ms: number) => (now += ms) };
}

const base = { ownerId: 'u1', guildId: 'g1' };
const ingestCall = (ingest: jest.Mock) => (ingest.mock.calls[0] as Parameters<SyncService['ingest']>)[0];

describe('ManualSyncService', () => {
  it('decodes a code and ingests it as a manual sync of the member', async () => {
    const { service, ingest, executeRaw } = setup();

    const outcome = await service.run({ ...base, input: { kind: 'code', text: CODE } });

    expect(outcome).toEqual({ status: 'done', results: RESULTS });
    const call = ingestCall(ingest);
    expect(call.ownerId).toBe('u1');
    expect(call.source).toBe('manual');
    expect(call.payload.schema).toBe(1);
    expect(call.payload.characters.map((c) => c.key.firstName)).toEqual(['Davina']);
    // player, guild_config and membership rows, like /lier.
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it('loads a file and ingests every character it holds', async () => {
    const { service, ingest } = setup();

    const outcome = await service.run({ ...base, input: { kind: 'file', load: () => Promise.resolve(FILE) } });

    expect(outcome.status).toBe('done');
    const { payload } = ingestCall(ingest);
    expect(payload.sentAt).toBe(Math.floor(T0_MS / 1_000));
    expect(payload.characters).toHaveLength(2);
  });

  it('refuses a corrupted code without touching the database', async () => {
    const { service, ingest, executeRaw } = setup();

    expect(await service.run({ ...base, input: { kind: 'code', text: 'FT1:abc' } })).toEqual({
      status: 'refused',
      reason: 'code_corrupt',
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('refuses a trapped file', async () => {
    const { service, ingest } = setup();

    expect(await service.run({ ...base, input: { kind: 'file', load: () => Promise.resolve(MALICIOUS) } })).toEqual({
      status: 'refused',
      reason: 'not_literal',
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('maps a loader failure to its refusal reason', async () => {
    const { service } = setup();
    const load = () => Promise.reject(new ManualSyncInputError('too_large'));

    expect(await service.run({ ...base, input: { kind: 'file', load } })).toEqual({ status: 'refused', reason: 'too_large' });
  });

  it('lets one attempt per member through every 2 minutes, refused ones included, before loading anything', async () => {
    const { service, advance } = setup();
    expect(MANUAL_SYNC_RATE_LIMIT).toEqual({ limit: 1, windowSec: 120 });

    await service.run({ ...base, input: { kind: 'code', text: 'garbage' } });
    advance(60_000);
    const load = jest.fn();
    expect(await service.run({ ...base, input: { kind: 'file', load } })).toEqual({ status: 'rate_limited', retryAfterSec: 60 });
    expect(load).not.toHaveBeenCalled();

    // Another member has their own budget.
    expect((await service.run({ ownerId: 'u2', guildId: 'g1', input: { kind: 'code', text: CODE } })).status).toBe('done');

    advance(60_000);
    expect((await service.run({ ...base, input: { kind: 'code', text: CODE } })).status).toBe('done');
  });
});
