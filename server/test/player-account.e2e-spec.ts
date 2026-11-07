import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { PlayerAccountService } from '../src/core/players/player-account.service';
import { GuildSettingsService } from '../src/discord/admin/guild-settings.service';
import { SuspectsQueryService } from '../src/discord/admin/suspects-query.service';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { PairingService } from '../src/ingest/pairing/pairing.service';
import { FakeDiscordClient } from './fake-discord-client';

const USER = '300000000000000001';
const OTHER = '300000000000000002';
const GUILD = '400000000000000001';
const GUILD_2 = '400000000000000002';
const heartbeat = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contract', 'fixtures', 'heartbeat.running.json'), 'utf8'),
) as object;

let app: INestApplication<App>;
let prisma: PrismaService;
let pairing: PairingService;
let accounts: PlayerAccountService;
let settings: GuildSettingsService;
let suspects: SuspectsQueryService;

async function pairedToken(owner = USER, guildId = GUILD): Promise<string> {
  const { code } = await pairing.issueCode({ discordUserId: owner, guildId });
  const res = await request(app.getHttpServer())
    .post('/v1/devices/pair')
    .send({ code, deviceName: 'PC', appVersion: '0.1.0', os: 'windows' })
    .expect(201);
  return (res.body as { deviceToken: string }).deviceToken;
}

const sendHeartbeat = (token: string) =>
  request(app.getHttpServer()).post('/v1/heartbeat').set('Authorization', `Bearer ${token}`).send(heartbeat);

async function character(ownerId: string | null, firstName: string, role: string | null) {
  return prisma.character.create({ data: { region: 'eu', firstName, surname: 'Test', ownerId, role } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(new FakeDiscordClient())
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);
  pairing = app.get(PairingService);
  accounts = app.get(PlayerAccountService);
  settings = app.get(GuildSettingsService);
  suspects = app.get(SuspectsQueryService);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, device, pairing_code, character, snapshot, game_event, game_session RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await app.close();
});

describe('/quitter: PlayerAccountService.quit (e2e)', () => {
  it('after /quitter, the device gets 401 on its next request', async () => {
    const token = await pairedToken();
    await sendHeartbeat(token).expect(200);

    await accounts.quit(USER);

    const res = await sendHeartbeat(token);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'invalid_token' } });
  });

  it('deletes the player, devices, sessions, memberships; detaches characters as untracked', async () => {
    await pairedToken(USER, GUILD);
    await pairing.issueCode({ discordUserId: USER, guildId: GUILD_2 });
    const main = await character(USER, 'Davina', 'main');
    const alt = await character(USER, 'Borek', 'alt');
    await prisma.gameSession.create({ data: { ownerId: USER, characterId: main.id, startedAt: new Date() } });
    const kept = await character(OTHER, 'Ilsa', 'main');

    const result = await accounts.quit(USER);

    expect(result.deleted).toBe(true);
    expect(result.guildIds.sort()).toEqual([GUILD, GUILD_2]);
    expect(await prisma.player.findUnique({ where: { discordUserId: USER } })).toBeNull();
    expect(await prisma.device.count({ where: { ownerId: USER } })).toBe(0);
    expect(await prisma.pairingCode.count({ where: { ownerId: USER } })).toBe(0);
    expect(await prisma.gameSession.count({ where: { ownerId: USER } })).toBe(0);
    expect(await prisma.membership.count({ where: { discordUserId: USER } })).toBe(0);
    const detached = await prisma.character.findMany({ where: { id: { in: [main.id, alt.id] } } });
    expect(detached.map((c) => [c.ownerId, c.role])).toEqual([
      [null, 'untracked'],
      [null, 'untracked'],
    ]);
    expect(await prisma.character.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ ownerId: OTHER, role: 'main' });
  });

  it('answers deleted: false for an unknown player', async () => {
    expect(await accounts.quit(USER)).toEqual({ deleted: false, guildIds: [] });
  });

  it('the cleanup deletes orphan characters with their snapshots and events, and nothing else', async () => {
    const orphan = await character(null, 'Davina', 'untracked');
    await prisma.snapshot.create({ data: { characterId: orphan.id, capturedAt: new Date(), level: 3, detail: {} } });
    await prisma.gameEvent.create({ data: { characterId: orphan.id, eventId: 'e1', type: 'DEATH', at: new Date(), data: {} } });
    await prisma.player.create({ data: { discordUserId: OTHER } });
    const owned = await character(OTHER, 'Ilsa', 'main');

    expect(await accounts.deleteOrphanCharacters()).toBe(1);

    expect((await prisma.character.findMany()).map((c) => c.id)).toEqual([owned.id]);
    expect(await prisma.snapshot.count()).toBe(0);
    expect(await prisma.gameEvent.count()).toBe(0);
  });
});

describe('/confidentialite: PlayerAccountService privacy (e2e)', () => {
  it('reads defaults for an unknown player without creating it', async () => {
    expect(await accounts.getPrivacy(USER)).toEqual({ hideMoney: false, hideZone: false, hidePresence: false });
    expect(await prisma.player.count()).toBe(0);
  });

  it('creates the player if needed and changes only the given flags', async () => {
    expect(await accounts.setPrivacy(USER, { hideMoney: true })).toEqual({ hideMoney: true, hideZone: false, hidePresence: false });
    expect(await accounts.setPrivacy(USER, { hidePresence: true })).toEqual({ hideMoney: true, hideZone: false, hidePresence: true });
    expect(await accounts.setPrivacy(USER, { hideMoney: false })).toEqual({ hideMoney: false, hideZone: false, hidePresence: true });
  });
});

describe('/config: GuildSettingsService (e2e)', () => {
  it('reads defaults for an unknown guild', async () => {
    expect(await settings.get(GUILD)).toEqual({ levelAnnounceStep: 1, logDeaths: false, boardSort: 'level', boardChannelId: null });
  });

  it('creates the guild_config if needed and changes only the given settings', async () => {
    await settings.update(GUILD, { boardSort: 'name' });
    const updated = await settings.update(GUILD, { levelAnnounceStep: 10, logDeaths: true });

    expect(updated).toEqual({ levelAnnounceStep: 10, logDeaths: true, boardSort: 'name', boardChannelId: null });
    expect(await prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } })).toMatchObject({
      levelAnnounceStep: 10,
      logDeaths: true,
      boardSort: 'name',
    });
  });
});

describe('/admin suspects: SuspectsQueryService (e2e)', () => {
  it('lists flagged snapshots and events of this guild’s members since the given date, newest first', async () => {
    const now = Date.now();
    const since = new Date(now - 7 * 86_400_000);
    await pairing.issueCode({ discordUserId: USER, guildId: GUILD });
    await pairing.issueCode({ discordUserId: OTHER, guildId: GUILD_2 });
    const mine = await character(USER, 'Davina', 'main');
    const theirs = await character(OTHER, 'Ilsa', 'main');
    const snap = (characterId: bigint, flags: string[], receivedAt: Date) =>
      prisma.snapshot.create({ data: { characterId, capturedAt: receivedAt, receivedAt, level: 20, detail: {}, flags } });
    await snap(mine.id, ['suspect_level_jump'], new Date(now - 3_600_000));
    await snap(mine.id, [], new Date(now - 60_000)); // not flagged
    await snap(mine.id, ['suspect_level_jump'], new Date(now - 8 * 86_400_000)); // too old
    await snap(theirs.id, ['suspect_level_jump'], new Date(now - 60_000)); // other guild
    await prisma.gameEvent.create({
      data: { characterId: mine.id, eventId: 'e1', type: 'LEVEL_UP', at: new Date(now - 60_000), data: {}, flags: ['suspect_level_jump'] },
    });

    const items = await suspects.list(GUILD, since);

    expect(items).toEqual([
      expect.objectContaining({ kind: 'event', type: 'LEVEL_UP', ownerId: USER, flags: ['suspect_level_jump'] }),
      expect.objectContaining({ kind: 'snapshot', level: 20, ownerId: USER, character: { region: 'eu', firstName: 'Davina', surname: 'Test' } }),
    ]);
  });
});
