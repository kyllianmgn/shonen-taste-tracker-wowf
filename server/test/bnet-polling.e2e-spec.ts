import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { BnetAccountPoller } from '../src/bnet/polling/bnet-account-poller.service';
import { BNET_POLL_CLOCK } from '../src/bnet/polling/poll-clock';
import { loadConfig } from '../src/common/config/config';
import { encryptToken } from '../src/common/crypto/token-cipher';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { PlayerModeService } from '../src/core/players/player-mode.service';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { SYNC_EVENTS, type CharacterUpdatedEvent, type EventRecordedEvent } from '../src/ingest/sync/sync.events';
import { SyncService } from '../src/ingest/sync/sync.service';
import type { SyncRequest } from '../src/ingest/sync/sync.types';
import { sha256Hex } from '../src/ingest/pairing/pairing-secrets';
import { FakeDiscordClient } from './fake-discord-client';

const FIXTURES = join(__dirname, '..', '..', 'contract', 'fixtures', 'bnet');
const EU = 'https://eu.api.blizzard.com';
const USER = '300000000000000001';
const OTHER = '300000000000000002';
const KEY = Buffer.from(process.env.TOKEN_ENC_KEY!, 'base64');
const HOUR = 3_600_000;

/** Fixed poll clock: a round time in the past, so /sync timestamps stay valid. */
let nowMs = Date.UTC(2026, 10, 6, 12, 0, 0);

let app: INestApplication<App>;
let prisma: PrismaService;
let poller: BnetAccountPoller;
let updated: CharacterUpdatedEvent[];
let recorded: EventRecordedEvent[];

function profile(levels: Record<string, number>) {
  const body = JSON.parse(readFileSync(join(FIXTURES, 'account-profile.json'), 'utf8')) as {
    wow_accounts: Array<{ characters: Array<Record<string, unknown>> }>;
  };
  const davina = body.wow_accounts[0].characters[0];
  body.wow_accounts[0].characters = Object.entries(levels).map(([name, level], i) => ({
    ...davina,
    name,
    id: 716333 + i,
    level,
  }));
  return body;
}

function mockProfile(levels: Record<string, number>, status = 200): nock.Scope {
  return nock(EU, { reqheaders: { authorization: 'Bearer test-user-token' } })
    .get('/profile/user/wow')
    .query({ namespace: 'profile-forever-eu', locale: 'fr_FR' })
    .reply(status, status === 200 ? profile(levels) : { code: status });
}

async function player(id: string): Promise<void> {
  await prisma.player.upsert({ where: { discordUserId: id }, create: { discordUserId: id }, update: {} });
}

async function storeToken(ownerId: string, expiresAt = new Date(nowMs + 20 * HOUR)): Promise<void> {
  await player(ownerId);
  await prisma.bnetToken.create({
    data: { ownerId, region: 'eu', tokenEncrypted: encryptToken(KEY, 'test-user-token'), expiresAt },
  });
}

/** A character of `ownerId`, verified by Battle.net, with an optional last snapshot. */
async function character(ownerId: string, firstName: string, level: number | null, role = 'main'): Promise<bigint> {
  await player(ownerId);
  const { id } = await prisma.character.create({
    data: { region: 'eu', firstName, surname: 'Asaria', ownerId, role, bnetVerified: true },
  });
  if (level !== null) {
    const snap = await prisma.snapshot.create({
      data: { characterId: id, capturedAt: new Date(nowMs - HOUR), level, detail: {}, source: 'app' },
    });
    await prisma.character.update({ where: { id }, data: { lastSnapshotId: snap.id } });
  }
  return id;
}

const levelUps = (characterId: bigint) =>
  prisma.gameEvent.findMany({ where: { characterId, type: 'LEVEL_UP' }, orderBy: { id: 'asc' } });

const lastSnapshot = async (characterId: bigint) => {
  const c = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  return c.lastSnapshotId === null ? null : prisma.snapshot.findUniqueOrThrow({ where: { id: c.lastSnapshotId } });
};

/** A manual /sync of Davina at `level`, optionally with the addon's own LEVEL_UP events. */
function manualSync(level: number, capturedAtMs: number, events: SyncRequest['characters'][number]['events'] = []) {
  const payload = {
    sentAt: Math.floor(capturedAtMs / 1000),
    schema: 1,
    addonVersion: '0.1.0',
    characters: [
      {
        key: { region: 'eu', firstName: 'Davina', surname: 'Asaria' },
        snapshot: { capturedAt: Math.floor(capturedAtMs / 1000), level },
        events,
      },
    ],
  } as unknown as SyncRequest;
  return app.get(SyncService).ingest({ ownerId: USER, payload, source: 'manual' });
}

beforeAll(async () => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .overrideProvider(BNET_POLL_CLOCK)
    .useValue({ now: () => nowMs })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);
  poller = app.get(BnetAccountPoller);
  const emitter = app.get(EventEmitter2);
  emitter.on(SYNC_EVENTS.characterUpdated, (e: CharacterUpdatedEvent) => updated.push(e));
  emitter.on(SYNC_EVENTS.eventRecorded, (e: EventRecordedEvent) => recorded.push(e));
});

beforeEach(async () => {
  nock.cleanAll();
  nowMs = Date.UTC(2026, 10, 6, 12, 0, 0);
  updated = [];
  recorded = [];
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, character, device, snapshot, game_event, bnet_token RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  nock.cleanAll();
  nock.enableNetConnect();
  await app.close();
});

describe('Battle.net account polling (base mode, e2e)', () => {
  it('a 21 → 23 change stores a bnet_account snapshot and two deduced LEVEL_UP', async () => {
    const davina = await character(USER, 'Davina', 21);
    await storeToken(USER);
    const api = mockProfile({ Davina: 23 });

    await poller.pollAll();

    expect(api.isDone()).toBe(true);
    expect(await lastSnapshot(davina)).toMatchObject({ level: 23, source: 'bnet_account', capturedAt: new Date(nowMs) });
    const events = await levelUps(davina);
    expect(events.map((e) => [e.eventId, e.data])).toEqual([
      [`bnet-${davina}-22`, { level: 22 }],
      [`bnet-${davina}-23`, { level: 23 }],
    ]);
    expect(events.every((e) => e.at.getTime() === nowMs && e.flags.length === 0)).toBe(true);

    expect(updated).toEqual([expect.objectContaining({ characterId: davina, ownerId: USER, level: 23, source: 'bnet_account', role: 'main' })]);
    expect(recorded.map((e) => e.eventId)).toEqual([`bnet-${davina}-22`, `bnet-${davina}-23`]);
    expect(recorded[0]).toMatchObject({ type: 'LEVEL_UP', source: 'bnet_account', ownerId: USER, flags: [] });
  });

  it('then a /sync at the same level and the next poll create no further LEVEL_UP', async () => {
    const davina = await character(USER, 'Davina', 21);
    await storeToken(USER);
    mockProfile({ Davina: 23 });
    await poller.pollAll();

    await manualSync(23, nowMs + 60_000);
    nowMs += 10 * 60_000;
    mockProfile({ Davina: 23 });
    recorded = [];
    await poller.pollAll();

    expect((await levelUps(davina)).map((e) => e.eventId)).toEqual([`bnet-${davina}-22`, `bnet-${davina}-23`]);
    expect(recorded).toEqual([]);
    expect(await prisma.snapshot.count({ where: { characterId: davina, source: 'bnet_account' } })).toBe(1);
  });

  it('a /sync that already brought the level and its LEVEL_UP leaves nothing to deduce', async () => {
    const davina = await character(USER, 'Davina', 21);
    await storeToken(USER);
    const at = Math.floor((nowMs - 30 * 60_000) / 1000);
    await manualSync(23, nowMs - 30 * 60_000, [
      { id: 'Player-4242-0A1B2C3D-1-1', type: 'LEVEL_UP', at, data: { level: 22 } },
      { id: 'Player-4242-0A1B2C3D-1-2', type: 'LEVEL_UP', at, data: { level: 23 } },
    ]);
    mockProfile({ Davina: 23 });

    await poller.pollAll();

    expect((await levelUps(davina)).map((e) => e.eventId)).toEqual(['Player-4242-0A1B2C3D-1-1', 'Player-4242-0A1B2C3D-1-2']);
    expect((await lastSnapshot(davina))?.source).toBe('manual');
  });

  it('skips the levels the addon already reported even when its snapshot was older', async () => {
    const davina = await character(USER, 'Davina', 21);
    await storeToken(USER);
    await prisma.gameEvent.create({
      data: { characterId: davina, eventId: 'Player-x-1', type: 'LEVEL_UP', at: new Date(nowMs - 5 * 60_000), data: { level: 22 } },
    });
    mockProfile({ Davina: 23 });

    await poller.pollAll();

    expect((await levelUps(davina)).map((e) => e.eventId)).toEqual(['Player-x-1', `bnet-${davina}-23`]);
  });

  it('the first poll after the link only stores a baseline snapshot', async () => {
    const davina = await character(USER, 'Davina', null);
    await storeToken(USER);
    mockProfile({ Davina: 21 });

    await poller.pollAll();

    expect(await lastSnapshot(davina)).toMatchObject({ level: 21, source: 'bnet_account' });
    expect(await levelUps(davina)).toEqual([]);
  });

  it('stores nothing when the level did not change or went down (stale API data)', async () => {
    const davina = await character(USER, 'Davina', 23);
    await storeToken(USER);
    mockProfile({ Davina: 23 });
    await poller.pollAll();
    mockProfile({ Davina: 22 });
    await poller.pollAll();

    expect(await prisma.snapshot.count({ where: { characterId: davina } })).toBe(1);
    expect(await levelUps(davina)).toEqual([]);
    expect(updated).toEqual([]);
  });

  it('only touches the token owner’s characters', async () => {
    await character(USER, 'Davina', 21);
    const other = await character(OTHER, 'Kael', 5);
    await storeToken(USER);
    mockProfile({ Davina: 21, Kael: 9, Inconnu: 30 });

    await poller.pollAll();

    expect(await prisma.snapshot.count({ where: { characterId: other } })).toBe(1);
    expect(await prisma.character.count({ where: { firstName: 'Inconnu' } })).toBe(0);
  });

  it('deletes expired tokens without calling Battle.net', async () => {
    await character(USER, 'Davina', 21);
    await storeToken(USER, new Date(nowMs - 1));
    await storeToken(OTHER, new Date(nowMs + HOUR));
    mockProfile({});

    await poller.pollAll();

    expect(await prisma.bnetToken.findMany({ select: { ownerId: true } })).toEqual([{ ownerId: OTHER }]);
  });

  it('deletes a token Battle.net refuses twice (401) and keeps polling the others', async () => {
    await character(USER, 'Davina', 21);
    const kael = await character(OTHER, 'Kael', 5);
    await storeToken(USER);
    await storeToken(OTHER);
    // Tokens are polled by owner id: USER first, retried once, then OTHER.
    nock(EU).get('/profile/user/wow').query(true).times(2).reply(401, {});
    mockProfile({ Kael: 6 });

    await poller.pollAll();

    expect(nock.isDone()).toBe(true);
    expect(await prisma.bnetToken.findMany({ select: { ownerId: true } })).toEqual([{ ownerId: OTHER }]);
    expect((await lastSnapshot(kael))?.level).toBe(6);
  });

  it('keeps a token refused once then accepted', async () => {
    const davina = await character(USER, 'Davina', 21);
    await storeToken(USER);
    nock(EU).get('/profile/user/wow').query(true).reply(401, {});
    mockProfile({ Davina: 22 });

    await poller.pollAll();

    expect(await prisma.bnetToken.count()).toBe(1);
    expect((await lastSnapshot(davina))?.level).toBe(22);
  });

  it('keeps the token when Battle.net is down', async () => {
    await character(USER, 'Davina', 21);
    await storeToken(USER);
    nock(EU).get('/profile/user/wow').query(true).reply(503, {});

    await poller.pollAll();

    expect(await prisma.bnetToken.count()).toBe(1);
  });
});

describe('PlayerModeService.bnetRelinkRegion (e2e)', () => {
  const service = () => app.get(PlayerModeService);

  it('asks to relink a base-mode player with verified characters and no valid token', async () => {
    await character(USER, 'Davina', 21);
    expect(await service().bnetRelinkRegion(USER)).toBe('eu');
  });

  it('is null while a token is valid', async () => {
    await character(USER, 'Davina', 21);
    await storeToken(USER, new Date(Date.now() + HOUR));
    expect(await service().bnetRelinkRegion(USER)).toBeNull();
  });

  it('is null in app mode or without any verified character', async () => {
    await character(USER, 'Davina', 21);
    await prisma.device.create({ data: { ownerId: USER, tokenSha256: sha256Hex('t'), lastSeenAt: new Date() } });
    expect(await service().bnetRelinkRegion(USER)).toBeNull();

    await player(OTHER);
    await prisma.character.create({ data: { region: 'eu', firstName: 'Kael', surname: 'Ombre', ownerId: OTHER, role: 'main' } });
    expect(await service().bnetRelinkRegion(OTHER)).toBeNull();
  });
});
