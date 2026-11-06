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
import { PresenceExpiryJob } from '../src/jobs/presence-expiry.job';
import { PRESENCE_CLOCK } from '../src/presence/presence.clock';
import {
  PRESENCE_EVENTS,
  type SessionEndedEvent,
  type SessionStartedEvent,
} from '../src/presence/presence.events';
import { PresenceService } from '../src/presence/presence.service';
import { FakeDiscordClient } from './fake-discord-client';

const USER = '300000000000000001';
const T0 = 1_793_900_000;
const DAVINA = { region: 'eu', firstName: 'Davina', surname: 'Asaria' };
const MORWEN = { region: 'eu', firstName: 'Morwen', surname: 'Asaria' };

const contract = new ContractValidator();
const fixturesDir = join(findContractDir(), 'fixtures');
const fixture = <T = Record<string, unknown>>(name: string): T =>
  JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as T;

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

let nowMs = 0;
const clock: Clock = { now: () => nowMs };
const setNow = (sec: number) => (nowMs = sec * 1_000);

let app: INestApplication<App>;
let prisma: PrismaService;
let presence: PresenceService;
let job: PresenceExpiryJob;
let started: SessionStartedEvent[];
let ended: SessionEndedEvent[];

let tokenCounter = 0;
async function deviceOf(ownerId: string): Promise<{ token: string; id: string }> {
  const token = `presence-token-${++tokenCounter}-xxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 43);
  await prisma.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`;
  const { id } = await prisma.device.create({ data: { ownerId, tokenSha256: sha256Hex(token), name: 'PC-salon' } });
  return { token, id };
}

function heartbeat(token: string | undefined, body: unknown) {
  const req = request(app.getHttpServer()).post('/v1/heartbeat');
  return (token === undefined ? req : req.set('Authorization', `Bearer ${token}`)).send(body as object);
}

async function heartbeatOk(token: string, body: unknown) {
  const res = await heartbeat(token, body);
  expect(res.status).toBe(200);
  expect(contract.validate('heartbeat.response', res.body)).toEqual({ ok: true });
  return res.body as { heartbeatIntervalSec: number; serverTime: number };
}

async function syncOk(token: string, body: unknown) {
  const res = await request(app.getHttpServer())
    .post('/v1/sync')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);
  expect(res.status).toBe(200);
  // Presence reacts to the sync's internal events after the response.
  await presence.whenIdle();
  return res.body as { results: { status: string }[] };
}

const sessions = () => prisma.gameSession.findMany({ orderBy: { id: 'asc' } });

/** A heartbeat body at `sentAt` (the fixtures carry their own). */
const beat = (gameRunning: boolean, sentAt: number, lastCharacter: object | undefined = DAVINA) => ({
  sentAt,
  gameRunning,
  appVersion: '0.1.0',
  ...(lastCharacter ? { lastCharacter } : {}),
});

/** sync.valid moved in time and optionally renamed / re-levelled. */
function syncAt(capturedAt: number, over: { key?: object; level?: number; money?: number; played?: number; events?: SyncPayload['characters'][number]['events'] } = {}): SyncPayload {
  const body = fixture<SyncPayload>('sync.valid');
  const c = body.characters[0];
  body.sentAt = capturedAt;
  c.key = { ...c.key, ...over.key };
  c.snapshot.capturedAt = capturedAt;
  if (over.level !== undefined) c.snapshot.level = over.level;
  if (over.money !== undefined) c.snapshot.money = over.money;
  if (over.played !== undefined) c.snapshot.playedTotal = over.played;
  c.events = over.events ?? [];
  return body;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .overrideProvider(INGEST_CLOCK)
    .useValue(clock)
    .overrideProvider(PRESENCE_CLOCK)
    .useValue(clock)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);
  presence = app.get(PresenceService);
  job = app.get(PresenceExpiryJob);

  const emitter = app.get(EventEmitter2);
  emitter.on(PRESENCE_EVENTS.sessionStarted, (e: SessionStartedEvent) => started.push(e));
  emitter.on(PRESENCE_EVENTS.sessionEnded, (e: SessionEndedEvent) => ended.push(e));
});

beforeEach(async () => {
  started = [];
  ended = [];
  presence.reset();
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, device, pairing_code, "character", snapshot, game_event, game_session RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
});

describe('POST /v1/heartbeat (e2e)', () => {
  it('answers the interval and the server time, and stores game_running and last_seen_at', async () => {
    const { token, id } = await deviceOf(USER);
    setNow(T0 - 1000);

    const body = await heartbeatOk(token, fixture('heartbeat.running'));

    expect(body).toEqual({ heartbeatIntervalSec: 600, serverTime: T0 - 1000 });
    const device = await prisma.device.findUniqueOrThrow({ where: { id } });
    expect(device).toMatchObject({ gameRunning: true, appVersion: '0.1.0', lastSeenAt: new Date((T0 - 1000) * 1000) });
  });

  it('rejects a body that does not match heartbeat.request (400 validation_failed)', async () => {
    const { token } = await deviceOf(USER);
    const res = await heartbeat(token, { sentAt: T0, appVersion: '0.1.0' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('rejects a missing token (401 invalid_token)', async () => {
    const res = await heartbeat(undefined, fixture('heartbeat.running'));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'invalid_token' } });
  });

  it('allows 2 heartbeats per minute per device (429 rate_limited)', async () => {
    const { token } = await deviceOf(USER);
    setNow(T0 + 5_000);
    await heartbeatOk(token, beat(true, T0 + 5_000));
    await heartbeatOk(token, beat(true, T0 + 5_000));
    const res = await heartbeat(token, beat(true, T0 + 5_000));
    expect(res.status).toBe(429);
  });
});

describe('sessions (e2e)', () => {
  it('heartbeat.running then heartbeat.stopped: opens, follows the sync, closes with game_closed after 90 s', async () => {
    const { token } = await deviceOf(USER);

    // heartbeat.running at T0 - 1000: the character is still unknown to the server.
    setNow(T0 - 1000);
    await heartbeatOk(token, fixture('heartbeat.running'));
    expect(await sessions()).toEqual([
      expect.objectContaining({ ownerId: USER, characterId: null, startedAt: new Date((T0 - 1000) * 1000), endedAt: null }),
    ]);
    expect(started).toEqual([expect.objectContaining({ ownerId: USER, characterId: null })]);

    // sync.valid: Davina (level 22 at SESSION_START, level 23 at T0) joins the session.
    setNow(T0 + 10);
    await syncOk(token, fixture('sync.valid'));
    const davina = await prisma.character.findFirstOrThrow({ where: { firstName: 'Davina' } });
    expect((await sessions())[0]).toMatchObject({
      characterId: davina.id,
      levelStart: 22,
      levelEnd: 23,
      moneyStart: 384512n,
      moneyEnd: 384512n,
      playedStart: 81234,
      playedEnd: 81234,
    });

    // heartbeat.stopped at T0 + 700: nothing closes before the 90 s wait for a final sync.
    setNow(T0 + 700);
    await heartbeatOk(token, fixture('heartbeat.stopped'));
    setNow(T0 + 789);
    await job.run();
    expect((await sessions())[0].endedAt).toBeNull();
    expect(ended).toEqual([]);

    setNow(T0 + 790);
    await job.run();
    expect((await sessions())[0]).toMatchObject({ endedAt: new Date((T0 + 700) * 1000), endReason: 'game_closed' });
    expect(ended).toEqual([
      expect.objectContaining({
        ownerId: USER,
        characterId: davina.id,
        reason: 'game_closed',
        quiet: false,
        recap: {
          durationSec: 1700,
          levelStart: 22,
          levelEnd: 23,
          levelsGained: 1,
          moneyDelta: 0,
          playedAddedSec: 0,
          endZone: 'Duskwood',
          endSubZone: 'Darkshire',
          deaths: 0,
        },
      }),
    ]);
  });

  it('closes with heartbeat_timeout at the last heartbeat once 2.5 × the interval has passed', async () => {
    const { token } = await deviceOf(USER);
    setNow(T0);
    await heartbeatOk(token, beat(true, T0));

    setNow(T0 + 1499);
    await job.run();
    expect(ended).toEqual([]);

    setNow(T0 + 1500);
    await job.run();
    expect((await sessions())[0]).toMatchObject({ endedAt: new Date(T0 * 1000), endReason: 'heartbeat_timeout' });
    expect(ended).toEqual([expect.objectContaining({ reason: 'heartbeat_timeout' })]);
  });

  it('starts from the last snapshot stored before the session and counts its deaths', async () => {
    const { token } = await deviceOf(USER);
    setNow(T0 + 10);
    await syncOk(token, syncAt(T0)); // level 23, 384512 copper, 81234 s played; no session yet
    expect(await sessions()).toEqual([]);

    setNow(T0 + 3600);
    await heartbeatOk(token, beat(true, T0 + 3600));
    setNow(T0 + 7300);
    await syncOk(
      token,
      syncAt(T0 + 7200, {
        level: 24,
        money: 400_000,
        played: 84_834,
        events: [
          { id: 'Player-4242-0A1B2C3D-1793903700-3', type: 'SESSION_START', at: T0 + 3700, data: { level: 23, zone: 'Duskwood' } },
          { id: 'Player-4242-0A1B2C3D-1793905000-4', type: 'DEATH', at: T0 + 5000, data: { level: 23, zone: 'Duskwood' } },
        ],
      }),
    );
    await heartbeatOk(token, beat(false, T0 + 7300));
    setNow(T0 + 7390);
    await job.run();

    expect(ended).toHaveLength(1);
    expect(ended[0].recap).toMatchObject({ levelsGained: 1, moneyDelta: 15_488, playedAddedSec: 3600, deaths: 1 });
  });

  it("splits on another character's SESSION_START: character_changed, then a new session", async () => {
    const { token } = await deviceOf(USER);
    setNow(T0);
    await heartbeatOk(token, beat(true, T0));
    setNow(T0 + 600);
    await syncOk(token, syncAt(T0 + 600, { events: [] })); // Davina
    setNow(T0 + 1200);
    await syncOk(
      token,
      syncAt(T0 + 1200, {
        key: { ...MORWEN, guid: 'Player-4242-0A1B2C3E' },
        level: 12,
        events: [{ id: 'Player-4242-0A1B2C3E-1793900900-1', type: 'SESSION_START', at: T0 + 900, data: { level: 12, zone: 'Durotar' } }],
      }),
    );

    const morwen = await prisma.character.findFirstOrThrow({ where: { firstName: 'Morwen' } });
    const [first, second] = await sessions();
    expect(first).toMatchObject({ endedAt: new Date((T0 + 900) * 1000), endReason: 'character_changed' });
    expect(second).toMatchObject({
      characterId: morwen.id,
      startedAt: new Date((T0 + 900) * 1000),
      endedAt: null,
      levelStart: 12,
      levelEnd: 12,
    });
    expect(ended).toEqual([expect.objectContaining({ reason: 'character_changed' })]);
    expect(started).toHaveLength(2);
  });

  it('marks a short session without any change as quiet (no log)', async () => {
    const { token } = await deviceOf(USER);
    setNow(T0);
    await heartbeatOk(token, beat(true, T0, undefined));
    setNow(T0 + 30);
    await heartbeatOk(token, beat(false, T0 + 30, undefined));
    setNow(T0 + 120);
    await job.run();

    expect(ended).toEqual([expect.objectContaining({ reason: 'game_closed', quiet: true })]);
  });

  it('keeps open sessions across a restart of the presence engine (no lost wait)', async () => {
    const { token } = await deviceOf(USER);
    setNow(T0);
    await heartbeatOk(token, beat(true, T0));
    setNow(T0 + 600);
    await heartbeatOk(token, beat(false, T0 + 600));

    presence.reset(); // forget the in-memory stop time, as after a restart
    setNow(T0 + 700);
    await job.run();

    expect((await sessions())[0]).toMatchObject({ endReason: 'game_closed', endedAt: new Date((T0 + 600) * 1000) });
  });
});
