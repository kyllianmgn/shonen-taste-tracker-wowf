import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { findContractDir } from '../src/common/contract/contract-validator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { INGEST_CLOCK, type Clock } from '../src/ingest/clock';
import { ManualSyncService } from '../src/ingest/share-code/manual-sync.service';
import { SYNC_EVENTS, type CharacterUpdatedEvent } from '../src/ingest/sync/sync.events';
import { FakeDiscordClient } from './fake-discord-client';

const USER = '300000000000000001';
const OTHER = '300000000000000002';
const GUILD = '400000000000000001';
const fixtures = join(findContractDir(), 'fixtures');
const CODE = readFileSync(join(fixtures, 'share-code.sample.txt'), 'utf8');
const FILE = readFileSync(join(fixtures, 'savedvariables', 'ForeverTracker.sample.lua'));
const MALICIOUS = readFileSync(join(fixtures, 'savedvariables', 'ForeverTracker.malicious.lua'));
const DAVINA = { region: 'eu', firstName: 'Davina', surname: 'Asaria' };

/** 40 s after the sample code's capturedAt (1793901260): nothing is in the future. */
const START_MS = 1_793_901_300_000;
let nowMs = START_MS;
const clock: Clock = { now: () => nowMs };

let app: INestApplication;
let prisma: PrismaService;
let manual: ManualSyncService;
let updated: CharacterUpdatedEvent[];

const code = (ownerId: string, text = CODE) => manual.run({ ownerId, guildId: GUILD, input: { kind: 'code', text } });
const file = (ownerId: string, bytes: Buffer) =>
  manual.run({ ownerId, guildId: GUILD, input: { kind: 'file', load: () => Promise.resolve(bytes) } });
/** Each test member gets a fresh 2-minute budget. */
const nextWindow = () => (nowMs += 121_000);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .overrideProvider(INGEST_CLOCK)
    .useValue(clock)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  prisma = app.get(PrismaService);
  manual = app.get(ManualSyncService);
  app.get(EventEmitter2).on(SYNC_EVENTS.characterUpdated, (e: CharacterUpdatedEvent) => updated.push(e));
});

beforeEach(async () => {
  nextWindow();
  updated = [];
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, device, "character", snapshot, game_event RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
});

describe('/sync — ManualSyncService (e2e)', () => {
  it('share-code.sample.txt: attaches Davina to the member, stores a manual snapshot and the 3 events', async () => {
    const outcome = await code(USER);

    expect(outcome).toEqual({
      status: 'done',
      results: [{ key: DAVINA, status: 'ok', acceptedEvents: 3, duplicateEvents: 0, flags: [] }],
    });
    const character = await prisma.character.findFirstOrThrow({ where: DAVINA });
    expect(character).toMatchObject({ ownerId: USER, role: 'main' });
    const snapshot = await prisma.snapshot.findFirstOrThrow({ where: { characterId: character.id } });
    expect(snapshot).toMatchObject({ source: 'manual', level: 24 });
    expect(await prisma.gameEvent.count({ where: { characterId: character.id } })).toBe(3);
    expect(updated).toEqual([expect.objectContaining({ ownerId: USER, source: 'manual', level: 24 })]);

    // The member now shows on this server, like after /lier.
    expect(await prisma.membership.findMany()).toEqual([{ guildId: GUILD, discordUserId: USER }]);
  });

  it('the same code again two minutes later only counts duplicates', async () => {
    await code(USER);
    nextWindow();

    expect(await code(USER)).toEqual({
      status: 'done',
      results: [{ key: DAVINA, status: 'ok', acceptedEvents: 0, duplicateEvents: 3, flags: [] }],
    });
    expect(await prisma.snapshot.count()).toBe(1);
  });

  it('a code for a character of another member is refused and stores nothing', async () => {
    await prisma.player.create({ data: { discordUserId: OTHER } });
    await prisma.character.create({ data: { ...DAVINA, ownerId: OTHER, role: 'main' } });

    expect(await code(USER)).toEqual({
      status: 'done',
      results: [{ key: DAVINA, status: 'owned_by_other', acceptedEvents: 0, duplicateEvents: 0, flags: [] }],
    });
    expect(await prisma.character.findFirstOrThrow({ where: DAVINA })).toMatchObject({ ownerId: OTHER });
    expect(await prisma.snapshot.count()).toBe(0);
    expect(await prisma.gameEvent.count()).toBe(0);
  });

  it('a corrupted code is refused and creates nothing', async () => {
    expect(await code(USER, CODE.trim().slice(0, 200))).toEqual({ status: 'refused', reason: 'code_corrupt' });
    expect(await prisma.player.count()).toBe(0);
    expect(await prisma.character.count()).toBe(0);
  });

  it('a valid SavedVariables file stores both characters as manual', async () => {
    const outcome = await file(USER, FILE);

    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') return;
    expect(outcome.results.map((r) => [r.key.firstName, r.status])).toEqual([
      ['Davina', 'ok'],
      ['Morwen', 'ok'],
    ]);
    const characters = await prisma.character.findMany({ orderBy: { id: 'asc' } });
    expect(characters.map((c) => c.role)).toEqual(['main', 'alt']);
    const snapshots = await prisma.snapshot.findMany();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((s) => s.source === 'manual')).toBe(true);
  });

  it('a trapped file is refused and creates nothing', async () => {
    expect(await file(USER, MALICIOUS)).toEqual({ status: 'refused', reason: 'not_literal' });
    expect(await prisma.player.count()).toBe(0);
  });

  it('allows one attempt per member every 2 minutes', async () => {
    await code(USER);
    nowMs += 30_000;

    expect(await code(USER)).toEqual({ status: 'rate_limited', retryAfterSec: 90 });
    expect(await prisma.gameEvent.count()).toBe(3);
  });
});
