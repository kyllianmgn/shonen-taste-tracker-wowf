import { Controller, Get, INestApplication, Module, UseGuards } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { ContractValidator } from '../src/common/contract/contract-validator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { CurrentDevice, type AuthenticatedDevice } from '../src/ingest/auth/current-device';
import { DeviceAuthGuard } from '../src/ingest/auth/device-auth.guard';
import { RateLimit, RateLimitGuard } from '../src/ingest/auth/rate-limit.guard';
import { IngestModule } from '../src/ingest/ingest.module';
import { sha256Hex } from '../src/ingest/pairing/pairing-secrets';
import { PAIRING_CODE_TTL_SEC, PairingService } from '../src/ingest/pairing/pairing.service';
import { FakeDiscordClient } from './fake-discord-client';

/** Stands for a future Bearer endpoint (heartbeat, sync): the guards must be reusable as is. */
@Controller('v1/test-protected')
@UseGuards(DeviceAuthGuard, RateLimitGuard)
class ProtectedTestController {
  @Get()
  @RateLimit({ limit: 2, windowSec: 60, by: 'device' })
  whoAmI(@CurrentDevice() device: AuthenticatedDevice) {
    return { deviceId: device.id, ownerId: device.ownerId };
  }
}

/** Like a later ingest feature module: it imports IngestModule to get the guards. */
@Module({ imports: [IngestModule], controllers: [ProtectedTestController] })
class ProtectedTestModule {}

const USER = '300000000000000001';
const GUILD = '400000000000000001';
const contract = new ContractValidator();

let app: INestApplication<App>;
let prisma: PrismaService;
let pairing: PairingService;

/** Each test pairs from its own address, so the per-IP limit of one test never leaks into another. */
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

const pairBody = (code: string) => ({ code, deviceName: 'PC-salon', appVersion: '0.1.0', os: 'windows' });

function pair(body: unknown, ip = freshIp()) {
  return request(app.getHttpServer()).post('/v1/devices/pair').set('X-Forwarded-For', ip).send(body as object);
}

function deleteMe(token?: string) {
  const req = request(app.getHttpServer()).delete('/v1/devices/me');
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

/** Pairs a new device for USER and returns its id and token. */
async function pairedDevice(): Promise<{ deviceId: string; deviceToken: string }> {
  const { code } = await pairing.issueCode({ discordUserId: USER, guildId: GUILD });
  const res = await pair(pairBody(code)).expect(201);
  return res.body as { deviceId: string; deviceToken: string };
}

function expectError(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ error: { code } });
  expect(contract.validate('error', res.body)).toEqual({ ok: true });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(loadConfig(process.env)), ProtectedTestModule],
  })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);
  pairing = app.get(PairingService);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE guild_config, player, device, pairing_code RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await app.close();
});

describe('/lier appli: PairingService.issueCode (e2e)', () => {
  it('stores only the SHA-256 of an 8-character code, valid 10 minutes', async () => {
    const before = Date.now();
    const { code, expiresAt } = await pairing.issueCode({ discordUserId: USER, guildId: GUILD });

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const rows = await prisma.pairingCode.findMany();
    expect(rows).toEqual([{ codeSha256: sha256Hex(code), ownerId: USER, expiresAt, usedAt: null }]);
    expect(PAIRING_CODE_TTL_SEC).toBe(600);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
  });

  it('creates the player and shows them on this server (membership), idempotently', async () => {
    await pairing.issueCode({ discordUserId: USER, guildId: GUILD });
    await pairing.issueCode({ discordUserId: USER, guildId: GUILD });

    expect(await prisma.player.findMany({ select: { discordUserId: true } })).toEqual([{ discordUserId: USER }]);
    expect(await prisma.membership.findMany()).toEqual([{ guildId: GUILD, discordUserId: USER }]);
    expect(await prisma.pairingCode.count()).toBe(2);
  });

  it('keeps an existing guild_config untouched', async () => {
    await prisma.guildConfig.create({ data: { guildId: GUILD, boardChannelId: 'b1', levelAnnounceStep: 10 } });

    await pairing.issueCode({ discordUserId: USER, guildId: GUILD });

    expect(await prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } })).toMatchObject({
      boardChannelId: 'b1',
      levelAnnounceStep: 10,
    });
  });
});

describe('POST /v1/devices/pair (e2e)', () => {
  it('201: creates the device, returns its token once and stores only its SHA-256', async () => {
    const { code } = await pairing.issueCode({ discordUserId: USER, guildId: GUILD });

    const res = await pair(pairBody(code)).expect(201);

    expect(contract.validate('pair.response', res.body)).toEqual({ ok: true });
    const { deviceId, deviceToken, heartbeatIntervalSec } = res.body as Record<string, unknown>;
    expect(heartbeatIntervalSec).toBe(600);
    expect(Buffer.from(deviceToken as string, 'base64url')).toHaveLength(32);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId as string } });
    expect(device).toMatchObject({
      ownerId: USER,
      tokenSha256: sha256Hex(deviceToken as string),
      name: 'PC-salon',
      appVersion: '0.1.0',
      os: 'windows',
      gameRunning: false,
      revokedAt: null,
    });
    expect(device.lastSeenAt).toBeInstanceOf(Date);
    expect(JSON.stringify(device)).not.toContain(deviceToken as string);

    const codeRow = await prisma.pairingCode.findUniqueOrThrow({ where: { codeSha256: sha256Hex(code) } });
    expect(codeRow.usedAt).toBeInstanceOf(Date);
  });

  it('gives a different token to each device', async () => {
    const a = await pairedDevice();
    const b = await pairedDevice();

    expect(a.deviceToken).not.toBe(b.deviceToken);
    expect(a.deviceId).not.toBe(b.deviceId);
  });

  it('404 code_unknown for a well-formed code that was never issued', async () => {
    expectError(await pair(pairBody('K7P29QXM')), 404, 'code_unknown');
    expect(await prisma.device.count()).toBe(0);
  });

  it('410 code_expired after the 10 minutes', async () => {
    await prisma.player.create({ data: { discordUserId: USER } });
    await prisma.pairingCode.create({
      data: { codeSha256: sha256Hex('K7P29QXM'), ownerId: USER, expiresAt: new Date(Date.now() - 1_000) },
    });

    expectError(await pair(pairBody('K7P29QXM')), 410, 'code_expired');
    expect(await prisma.device.count()).toBe(0);
  });

  it('409 code_used for a second use of the same code', async () => {
    const { code } = await pairing.issueCode({ discordUserId: USER, guildId: GUILD });
    await pair(pairBody(code)).expect(201);

    expectError(await pair(pairBody(code)), 409, 'code_used');
    expect(await prisma.device.count()).toBe(1);
  });

  it('409 code_used also once a used code has expired', async () => {
    await prisma.player.create({ data: { discordUserId: USER } });
    await prisma.pairingCode.create({
      data: {
        codeSha256: sha256Hex('K7P29QXM'),
        ownerId: USER,
        expiresAt: new Date(Date.now() - 1_000),
        usedAt: new Date(Date.now() - 60_000),
      },
    });

    expectError(await pair(pairBody('K7P29QXM')), 409, 'code_used');
  });

  it('pairs a single device when the same code is sent twice at once', async () => {
    const { code } = await pairing.issueCode({ discordUserId: USER, guildId: GUILD });

    const results = await Promise.all([pair(pairBody(code)), pair(pairBody(code))]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.device.count()).toBe(1);
  });

  it.each([
    ['a code outside the alphabet', { ...pairBody('K7P29QX0') }],
    ['a lowercase code', { ...pairBody('k7p29qxm') }],
    ['an unknown field', { ...pairBody('K7P29QXM'), extra: true }],
    ['a missing field', { code: 'K7P29QXM', deviceName: 'PC', appVersion: '0.1.0' }],
    ['an unknown os', { ...pairBody('K7P29QXM'), os: 'linux' }],
    ['a non-object body', ['K7P29QXM']],
  ])('400 validation_failed for %s', async (_label, body) => {
    expectError(await pair(body), 400, 'validation_failed');
  });

  it('400 validation_failed for malformed JSON', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/devices/pair')
      .set('X-Forwarded-For', freshIp())
      .set('Content-Type', 'application/json')
      .send('{"code": ');

    expectError(res, 400, 'validation_failed');
  });

  it('429 rate_limited with Retry-After after 5 attempts in a minute from the same IP', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expectError(await pair(pairBody('K7P29QXM'), ip), 404, 'code_unknown');

    const res = await pair(pairBody('K7P29QXM'), ip);

    expectError(res, 429, 'rate_limited');
    const retryAfter = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // Another address keeps its own budget.
    expectError(await pair(pairBody('K7P29QXM')), 404, 'code_unknown');
  });

  it('counts invalid bodies against the IP budget too', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await pair({}, ip);

    expectError(await pair({}, ip), 429, 'rate_limited');
  });
});

describe('Bearer guard (e2e)', () => {
  const get = (token?: string) => {
    const req = request(app.getHttpServer()).get('/v1/test-protected');
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };

  it('lets a valid token through, exposes the device and updates last_seen_at', async () => {
    const { deviceId, deviceToken } = await pairedDevice();
    const old = new Date('2026-01-01T00:00:00Z');
    await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: old } });

    const before = Date.now();
    const res = await get(deviceToken).expect(200);

    expect(res.body).toEqual({ deviceId, ownerId: USER });
    const { lastSeenAt } = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  it.each([
    ['no Authorization header', undefined],
    ['an unknown token', 'A'.repeat(43)],
    ['a malformed token', 'not-a-token'],
  ])('401 invalid_token for %s', async (_label, token) => {
    await pairedDevice();
    expectError(await get(token), 401, 'invalid_token');
  });

  it('401 invalid_token for a revoked device', async () => {
    const { deviceId, deviceToken } = await pairedDevice();
    await prisma.device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });

    expectError(await get(deviceToken), 401, 'invalid_token');
  });

  it('401 invalid_token once the player is deleted (/quitter)', async () => {
    const { deviceToken } = await pairedDevice();
    await prisma.player.delete({ where: { discordUserId: USER } });

    expectError(await get(deviceToken), 401, 'invalid_token');
  });

  it('429 rate_limited with Retry-After per device, not per IP', async () => {
    const a = await pairedDevice();
    const b = await pairedDevice();
    await get(a.deviceToken).expect(200);
    await get(a.deviceToken).expect(200);

    const res = await get(a.deviceToken);

    expectError(res, 429, 'rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    await get(b.deviceToken).expect(200);
  });
});

describe('DELETE /v1/devices/me (e2e)', () => {
  it('204: revokes the calling device only; its token then gets 401', async () => {
    const a = await pairedDevice();
    const b = await pairedDevice();

    const res = await deleteMe(a.deviceToken).expect(204);

    expect(res.text).toBe('');
    const revoked = await prisma.device.findUniqueOrThrow({ where: { id: a.deviceId } });
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: b.deviceId } })).revokedAt).toBeNull();
    expectError(await deleteMe(a.deviceToken), 401, 'invalid_token');
    await deleteMe(b.deviceToken).expect(204);
  });

  it('401 invalid_token without a valid token', async () => {
    expectError(await deleteMe(), 401, 'invalid_token');
    expectError(await deleteMe('B'.repeat(43)), 401, 'invalid_token');
  });
});

describe('other routes (e2e)', () => {
  it('keeps the health check out of the API error format', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', discord: 'up' });
  });

  it('leaves errors without a contract code to Nest, e.g. an unknown /v1 route', async () => {
    const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
  });
});
