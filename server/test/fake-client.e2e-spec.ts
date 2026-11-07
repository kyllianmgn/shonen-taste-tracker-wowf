import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AddressInfo, Server } from 'node:net';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { findContractDir } from '../src/common/contract/contract-validator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { INGEST_CLOCK, type Clock } from '../src/ingest/clock';
import { PairingService } from '../src/ingest/pairing/pairing.service';
import { PRESENCE_CLOCK } from '../src/presence/presence.clock';
import { PresenceService } from '../src/presence/presence.service';
import { FakeDiscordClient } from './fake-discord-client';

/**
 * S-10: tools/fake-client, run as its own process against a listening test server, pairs and
 * replays contract/fixtures/scenarios/session-levelup.json. The client uses the real time; the
 * server clock follows it, then jumps past the 90 s wait for the final sync.
 */
const execFileAsync = promisify(execFile);
const USER = '300000000000000001';
const GUILD = '200000000000000001';
const REPO = dirname(findContractDir());
const CLIENT = join(REPO, 'tools', 'fake-client', 'index.js');

let shiftMs = 0;
const clock: Clock = { now: () => Date.now() + shiftMs };

let app: INestApplication;
let prisma: PrismaService;
let presence: PresenceService;
let baseUrl: string;
let tokenDir: string;

function fakeClient(...args: string[]) {
  return execFileAsync(process.execPath, [CLIENT, ...args], {
    cwd: REPO,
    env: { ...process.env, API_BASE_URL: baseUrl, FAKE_CLIENT_TOKEN_FILE: join(tokenDir, '.token') },
  });
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
  await app.listen(0, '127.0.0.1');
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  prisma = app.get(PrismaService);
  presence = app.get(PresenceService);
  tokenDir = mkdtempSync(join(tmpdir(), 'fake-client-e2e-'));
});

beforeEach(async () => {
  shiftMs = 0;
  presence.reset();
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, device, pairing_code, "character", snapshot, game_event, game_session RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
  rmSync(tokenDir, { recursive: true, force: true });
});

describe('tools/fake-client (e2e)', () => {
  it('pairs, then the session-levelup scenario leaves one closed session with 1 level gained', async () => {
    const { code } = await app.get(PairingService).issueCode({ discordUserId: USER, guildId: GUILD });

    const paired = await fakeClient('pair', code);
    expect(paired.stdout).toMatch(/Appairé/);
    const device = await prisma.device.findFirstOrThrow({ where: { ownerId: USER } });
    expect(device.name).toBe('fake-client');

    const run = await fakeClient('scenario', 'contract/fixtures/scenarios/session-levelup.json');
    expect(run.stdout).toMatch(/Scénario terminé/);
    await presence.whenIdle();

    // The game stopped: the session waits 90 s for a final sync, then closes.
    shiftMs = 91_000;
    await presence.tickAll();
    await presence.whenIdle();

    const character = await prisma.character.findFirstOrThrow({ where: { ownerId: USER } });
    expect(character).toMatchObject({ firstName: 'Davina', surname: 'Asaria', role: 'main' });
    const sessions = await prisma.gameSession.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ characterId: character.id, endReason: 'game_closed', levelStart: 22, levelEnd: 23 });
    expect(sessions[0].endedAt).not.toBeNull();
    expect(sessions[0].levelEnd! - sessions[0].levelStart!).toBe(1);
    const events = await prisma.gameEvent.findMany({ orderBy: { at: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['SESSION_START', 'LEVEL_UP']);
  }, 60_000);
});
