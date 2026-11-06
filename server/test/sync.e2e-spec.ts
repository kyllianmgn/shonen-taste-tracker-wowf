import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { ContractValidator, findContractDir } from '../src/common/contract/contract-validator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { INGEST_CLOCK, type Clock } from '../src/ingest/clock';
import { sha256Hex } from '../src/ingest/pairing/pairing-secrets';
import {
  SYNC_EVENTS,
  type CharacterUpdatedEvent,
  type EventRecordedEvent,
} from '../src/ingest/sync/sync.events';
import { FakeDiscordClient } from './fake-discord-client';

const USER = '300000000000000001';
const OTHER = '300000000000000002';
const T0 = 1_793_900_000;
const DAVINA = { region: 'eu', firstName: 'Davina', surname: 'Asaria' };

const contract = new ContractValidator();
const fixturesDir = join(findContractDir(), 'fixtures');
const fixture = (name: string): SyncPayload =>
  JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as SyncPayload;

interface SyncPayload {
  sentAt: number;
  schema: number;
  addonVersion: string;
  characters: {
    key: Record<string, string>;
    snapshot: Record<string, unknown> & { capturedAt: number; level: number };
    events: { id: string; type: string; at: number; data: Record<string, unknown> }[];
  }[];
}

/** Fixed clock 700 s after T0: every fixture is in the past, none is more than 5 min ahead. */
let nowMs = (T0 + 700) * 1_000;
const clock: Clock = { now: () => nowMs };

let app: INestApplication<App>;
let prisma: PrismaService;
let updated: CharacterUpdatedEvent[];
let recorded: EventRecordedEvent[];

/** A paired device of `ownerId`, created straight in the database; returns its Bearer token. */
let tokenCounter = 0;
async function deviceOf(ownerId: string): Promise<string> {
  const token = `test-device-token-${++tokenCounter}-xxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 43);
  await prisma.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`;
  await prisma.device.create({ data: { ownerId, tokenSha256: sha256Hex(token), name: 'PC-salon' } });
  return token;
}

function sync(token: string | undefined, body: unknown) {
  const req = request(app.getHttpServer()).post('/v1/sync');
  return (token === undefined ? req : req.set('Authorization', `Bearer ${token}`)).send(body as object);
}

async function syncOk(token: string, body: unknown) {
  const res = await sync(token, body);
  expect(res.status).toBe(200);
  expect(contract.validate('sync.response', res.body)).toEqual({ ok: true });
  return res.body as { heartbeatIntervalSec: number; results: Record<string, unknown>[] };
}

function expectError(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ error: { code } });
  expect(contract.validate('error', res.body)).toEqual({ ok: true });
}

const davina = () =>
  prisma.character.findFirstOrThrow({ where: { region: 'eu', firstName: 'Davina', surname: 'Asaria' } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .overrideProvider(INGEST_CLOCK)
    .useValue(clock)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);

  const emitter = app.get(EventEmitter2);
  emitter.on(SYNC_EVENTS.characterUpdated, (e: CharacterUpdatedEvent) => updated.push(e));
  emitter.on(SYNC_EVENTS.eventRecorded, (e: EventRecordedEvent) => recorded.push(e));
});

beforeEach(async () => {
  nowMs = (T0 + 700) * 1_000;
  updated = [];
  recorded = [];
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, device, pairing_code, "character", snapshot, game_event RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
});

describe('POST /v1/sync — contract fixtures (e2e)', () => {
  it('sync.valid: auto-attaches an unknown character as main, stores the snapshot and both events', async () => {
    const token = await deviceOf(USER);

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body).toEqual({
      heartbeatIntervalSec: 600,
      results: [{ key: DAVINA, status: 'ok', acceptedEvents: 2, duplicateEvents: 0, flags: [] }],
    });

    const character = await davina();
    expect(character).toMatchObject({
      ownerId: USER,
      role: 'main',
      guid: 'Player-4242-0A1B2C3D',
      realmName: 'CAMWOW EU5 Realm 1 PvE',
      classFile: 'PRIEST',
      raceFile: 'Troll',
      faction: 'Horde',
    });

    const snapshots = await prisma.snapshot.findMany();
    expect(snapshots).toHaveLength(1);
    const [snapshot] = snapshots;
    expect(character.lastSnapshotId).toBe(snapshot.id);
    expect(snapshot).toMatchObject({
      characterId: character.id,
      capturedAt: new Date(T0 * 1_000),
      level: 23,
      xp: 4120,
      xpMax: 13600,
      money: 384512n,
      playedTotal: 81234,
      zone: 'Duskwood',
      subZone: 'Darkshire',
      source: 'app',
      flags: [],
    });
    expect(snapshot.detail).toMatchObject({
      rested: 2100,
      playedLevel: 2310,
      classFile: 'PRIEST',
      guild: 'Les Veilleurs',
      equipment: [{ slot: 1, itemId: 7720 }],
      professions: [{ name: 'Herboristerie', rank: 112, max: 150 }],
      reputations: [{ factionId: 76, standing: 5 }],
    });

    const events = await prisma.gameEvent.findMany({ orderBy: { at: 'asc' } });
    expect(events.map((e) => [e.eventId, e.type, e.at.getTime() / 1_000, e.flags, e.publishedAt])).toEqual([
      ['Player-4242-0A1B2C3D-1793899000-1', 'SESSION_START', 1793899000, [], null],
      ['Player-4242-0A1B2C3D-1793899800-2', 'LEVEL_UP', 1793899800, [], null],
    ]);
    expect(events[1].data).toEqual({ level: 23, playedTotal: 80900, zone: 'Duskwood' });
  });

  it('sync.valid emits character.updated once and event.recorded per new event', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    const character = await davina();

    expect(updated).toEqual([
      {
        characterId: character.id,
        ownerId: USER,
        role: 'main',
        snapshotId: character.lastSnapshotId,
        level: 23,
        source: 'app',
        flags: [],
      },
    ]);
    expect(recorded.map((e) => [e.eventId, e.type, e.characterId, e.ownerId, e.role, e.flags])).toEqual([
      ['Player-4242-0A1B2C3D-1793899000-1', 'SESSION_START', character.id, USER, 'main', []],
      ['Player-4242-0A1B2C3D-1793899800-2', 'LEVEL_UP', character.id, USER, 'main', []],
    ]);
    expect(recorded[1]).toMatchObject({ at: new Date(1793899800 * 1_000), data: { level: 23 }, source: 'app' });
  });

  it('sync.duplicate: replayed sync counts duplicates, stores nothing and emits nothing', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    updated = [];
    recorded = [];

    const body = await syncOk(token, fixture('sync.duplicate'));

    expect(body.results).toEqual([{ key: DAVINA, status: 'ok', acceptedEvents: 0, duplicateEvents: 2, flags: [] }]);
    expect(await prisma.snapshot.count()).toBe(1);
    expect(await prisma.gameEvent.count()).toBe(2);
    expect(updated).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('sync.regression: a lower level is rejected with flag regression and nothing is stored', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    const before = await davina();
    updated = [];

    const body = await syncOk(token, fixture('sync.regression'));

    expect(body.results).toEqual([
      { key: DAVINA, status: 'rejected', acceptedEvents: 0, duplicateEvents: 0, flags: ['regression'] },
    ]);
    expect(await prisma.snapshot.count()).toBe(1);
    expect((await davina()).lastSnapshotId).toBe(before.lastSnapshotId);
    expect(updated).toEqual([]);
  });

  it('sync.suspect-jump: +8 levels in 10 min is stored and flagged, events flagged so they are never published', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    updated = [];
    recorded = [];

    const body = await syncOk(token, fixture('sync.suspect-jump'));

    expect(body.results).toEqual([
      { key: DAVINA, status: 'ok', acceptedEvents: 8, duplicateEvents: 0, flags: ['suspect_level_jump'] },
    ]);
    const character = await davina();
    const last = await prisma.snapshot.findUniqueOrThrow({ where: { id: character.lastSnapshotId! } });
    expect(last).toMatchObject({ level: 31, flags: ['suspect_level_jump'], capturedAt: new Date((T0 + 600) * 1_000) });

    const jumps = await prisma.gameEvent.findMany({ where: { type: 'LEVEL_UP', at: { gt: new Date(T0 * 1_000) } } });
    expect(jumps).toHaveLength(8);
    expect(jumps.every((e) => e.flags.length === 1 && e.flags[0] === 'suspect_level_jump' && !e.publishedAt)).toBe(
      true,
    );

    expect(updated).toEqual([expect.objectContaining({ level: 31, flags: ['suspect_level_jump'] })]);
    expect(recorded).toHaveLength(8);
    expect(recorded.every((e) => e.flags.includes('suspect_level_jump'))).toBe(true);
  });

  it('a character owned by another member: owned_by_other, nothing stored, owner unchanged', async () => {
    await prisma.player.create({ data: { discordUserId: OTHER } });
    await prisma.character.create({ data: { ...DAVINA, ownerId: OTHER, role: 'main' } });
    const token = await deviceOf(USER);

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results).toEqual([
      { key: DAVINA, status: 'owned_by_other', acceptedEvents: 0, duplicateEvents: 0, flags: [] },
    ]);
    expect(await davina()).toMatchObject({ ownerId: OTHER, role: 'main', lastSnapshotId: null, guid: null });
    expect(await prisma.snapshot.count()).toBe(0);
    expect(await prisma.gameEvent.count()).toBe(0);
    expect(updated).toEqual([]);
    expect(recorded).toEqual([]);
  });
});

describe('POST /v1/sync — ownership (e2e)', () => {
  async function ownCharacter(ownerId: string, firstName: string, role: string) {
    return prisma.character.create({ data: { region: 'eu', firstName, surname: 'Test', ownerId, role } });
  }

  it('attaches as alt when the owner already has a main', async () => {
    const token = await deviceOf(USER);
    await ownCharacter(USER, 'Morwen', 'main');

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results[0]).toMatchObject({ status: 'ok' });
    expect(await davina()).toMatchObject({ ownerId: USER, role: 'alt' });
  });

  it('stores a third character as untracked: snapshot and events kept, status untracked', async () => {
    const token = await deviceOf(USER);
    await ownCharacter(USER, 'Morwen', 'main');
    await ownCharacter(USER, 'Kaelis', 'alt');

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results).toEqual([
      { key: DAVINA, status: 'untracked', acceptedEvents: 2, duplicateEvents: 0, flags: [] },
    ]);
    const character = await davina();
    expect(character).toMatchObject({ ownerId: USER, role: 'untracked' });
    expect(character.lastSnapshotId).not.toBeNull();
    expect(updated).toEqual([expect.objectContaining({ role: 'untracked' })]);
  });

  it('keeps an untracked character of the device owner untracked', async () => {
    const token = await deviceOf(USER);
    await prisma.character.create({ data: { ...DAVINA, ownerId: USER, role: 'untracked' } });

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results[0]).toMatchObject({ status: 'untracked' });
    expect(await davina()).toMatchObject({ ownerId: USER, role: 'untracked' });
  });

  it('attaches a known character with no owner (left by /quitter)', async () => {
    await prisma.character.create({ data: { ...DAVINA, ownerId: null, role: 'untracked' } });
    const token = await deviceOf(USER);

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results[0]).toMatchObject({ status: 'ok' });
    expect(await davina()).toMatchObject({ ownerId: USER, role: 'main' });
  });

  it('matches the stored character case-insensitively and echoes the key as sent', async () => {
    const token = await deviceOf(USER);
    await prisma.character.create({ data: { region: 'eu', firstName: 'DAVINA', surname: 'asaria', ownerId: USER, role: 'main' } });

    const body = await syncOk(token, fixture('sync.valid'));

    expect(body.results[0]).toMatchObject({ key: DAVINA, status: 'ok' });
    expect(await prisma.character.count()).toBe(1);
  });
});

describe('POST /v1/sync — validation rules (e2e)', () => {
  it('rejects a character whose capturedAt is more than 5 min ahead, and still processes the others', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid');
    const future = structuredClone(payload.characters[0]);
    future.key = { region: 'eu', firstName: 'Morwen', surname: 'Asaria' };
    future.snapshot.capturedAt = Math.floor(nowMs / 1_000) + 301;
    future.events = [];
    payload.characters.push(future);

    const body = await syncOk(token, payload);

    expect(body.results).toEqual([
      { key: DAVINA, status: 'ok', acceptedEvents: 2, duplicateEvents: 0, flags: [] },
      {
        key: { region: 'eu', firstName: 'Morwen', surname: 'Asaria' },
        status: 'rejected',
        acceptedEvents: 0,
        duplicateEvents: 0,
        flags: ['future_timestamp'],
      },
    ]);
    expect(await prisma.character.count()).toBe(1);
  });

  it('rejects a character with an event more than 5 min ahead: nothing of it is stored', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid');
    payload.characters[0].events[1].at = Math.floor(nowMs / 1_000) + 301;

    const body = await syncOk(token, payload);

    expect(body.results[0]).toMatchObject({ status: 'rejected', flags: ['future_timestamp'] });
    expect(await prisma.character.count()).toBe(0);
    expect(await prisma.gameEvent.count()).toBe(0);
  });

  it('ignores an older snapshot without error but records its new events', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    const payload = fixture('sync.regression');
    payload.characters[0].snapshot.capturedAt = T0 - 600;
    payload.characters[0].events = [{ id: 'Player-4242-0A1B2C3D-1793899400-9', type: 'DEATH', at: T0 - 600, data: {} }];
    updated = [];

    const body = await syncOk(token, payload);

    expect(body.results).toEqual([{ key: DAVINA, status: 'ok', acceptedEvents: 1, duplicateEvents: 0, flags: [] }]);
    expect(await prisma.snapshot.count()).toBe(1);
    expect(await prisma.gameEvent.count()).toBe(3);
    expect(updated).toEqual([]);
  });

  it('counts an event repeated inside one payload as a duplicate', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid');
    payload.characters[0].events.push(structuredClone(payload.characters[0].events[0]));

    const body = await syncOk(token, payload);

    expect(body.results[0]).toMatchObject({ acceptedEvents: 2, duplicateEvents: 1 });
  });
});

describe('POST /v1/sync — errors (e2e)', () => {
  it('401 invalid_token without a Bearer token', async () => {
    expectError(await sync(undefined, fixture('sync.valid')), 401, 'invalid_token');
  });

  it('400 validation_failed on a body that breaks sync.request.json', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid') as unknown as { characters: { key: { region: string } }[] };
    payload.characters[0].key.region = 'cn';
    expectError(await sync(token, payload), 400, 'validation_failed');
  });

  it('422 unknown_schema on another schema version', async () => {
    const token = await deviceOf(USER);
    expectError(await sync(token, { ...fixture('sync.valid'), schema: 2 }), 422, 'unknown_schema');
  });

  it('429 rate_limited on the third sync within a minute, with Retry-After', async () => {
    const token = await deviceOf(USER);
    await syncOk(token, fixture('sync.valid'));
    await syncOk(token, fixture('sync.duplicate'));
    const res = await sync(token, fixture('sync.duplicate'));
    expectError(res, 429, 'rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('accepts a body above the 100 KiB Express default, up to 512 KiB', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid');
    payload.characters[0].events[0].data = { pad: 'x'.repeat(400 * 1024) };
    await syncOk(token, payload);
  });

  it('413 payload_too_large above 512 KiB', async () => {
    const token = await deviceOf(USER);
    const payload = fixture('sync.valid');
    payload.characters[0].events[0].data = { pad: 'x'.repeat(513 * 1024) };
    expectError(await sync(token, payload), 413, 'payload_too_large');
  });
});
