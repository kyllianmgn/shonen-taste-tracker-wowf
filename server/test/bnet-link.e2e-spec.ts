import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Routes } from 'discord.js';
import nock from 'nock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { NO_FOREVER_CHARACTER_HELP } from '../src/bnet/oauth/link-outcome';
import { OAUTH_STATE_TTL_SEC } from '../src/bnet/oauth/oauth-state.service';
import { loadConfig } from '../src/common/config/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { configureApp } from '../src/configure-app';
import { BNET_LINK_MSG, BNET_SELECT_IDS } from '../src/discord/bnet-link/bnet-link-replies';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { components, handlers } from '../src/discord/commands/lier-battlenet';
import type { CommandContext } from '../src/discord/registry/command-handler';
import { sha256Hex } from '../src/ingest/pairing/pairing-secrets';
import { FakeDiscordClient, type RestCall } from './fake-discord-client';

const FIXTURES = join(__dirname, '..', '..', 'contract', 'fixtures', 'bnet');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

const OAUTH = 'https://oauth.battle.net';
const EU = 'https://eu.api.blizzard.com';
const APP_ID = '100000000000000001';
const REDIRECT_URI = 'http://localhost:3000/oauth/bnet/callback';
const USER = '300000000000000001';
const OTHER = '300000000000000002';
const GUILD = '400000000000000001';
const GUILD2 = '400000000000000002';
const INTERACTION_TOKEN = 'interaction-token-1';

const lierBattlenet = handlers.find((h) => h.key === 'lier battlenet')!;
const altMenu = components.find((c) => c.customId === BNET_SELECT_IDS.alt)!;

let app: INestApplication<App>;
let prisma: PrismaService;
let discord: FakeDiscordClient;
let ctx: CommandContext;

/** Davina (fixture) plus Kael, a character the server does not know yet. */
function accountProfile() {
  const profile = fixture('account-profile.json') as { wow_accounts: Array<{ characters: Array<Record<string, unknown>> }> };
  const davina = profile.wow_accounts[0].characters[0];
  profile.wow_accounts[0].characters.push({
    ...davina,
    name: 'Kael',
    surname: 'Ombre',
    id: 716334,
    level: 5,
    playable_class: { name: 'Mage', id: 8 },
  });
  return profile;
}

function mockCodeExchange(): nock.Scope {
  return nock(OAUTH)
    .post('/token', { grant_type: 'authorization_code', code: 'the-code', redirect_uri: REDIRECT_URI })
    .reply(200, fixture('token.json'));
}

function mockProfile(status = 200, body: unknown = accountProfile()): nock.Scope {
  return nock(EU, { reqheaders: { authorization: 'Bearer test-user-token' } })
    .get('/profile/user/wow')
    .query({ namespace: 'profile-forever-eu', locale: 'fr_FR' })
    .reply(status, body as nock.Body);
}

/** The realm index is cached 24 h by the shared client: these calls happen in the first test only. */
function mockRealm(): void {
  nock(OAUTH).post('/token', 'grant_type=client_credentials').optionally().reply(200, fixture('token.json'));
  nock(EU).get('/data/wow/realm/6855').query({ namespace: 'dynamic-forever-eu' }).optionally().reply(200, fixture('realm-6855.json'));
}

/** Runs /lier battlenet as USER on GUILD and returns the state carried by the link button. */
async function startLink(): Promise<string> {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    guildId: GUILD,
    user: { id: USER },
    token: INTERACTION_TOKEN,
    inGuild: () => true,
    options: { getString: () => null },
    reply: jest.fn(),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
  };
  await lierBattlenet.execute(interaction as never, ctx);
  const [[reply]] = editReply.mock.calls as [[{ components: Array<{ components: Array<{ url: string }> }> }]];
  const url = new URL(reply.components[0].components[0].url);
  return url.searchParams.get('state')!;
}

function callback(query: Record<string, string>) {
  return request(app.getHttpServer()).get('/oauth/bnet/callback').query(query);
}

const webhookEdits = (): RestCall[] =>
  discord.rest.calls.filter((c) => c.method === 'patch' && c.route === Routes.webhookMessage(APP_ID, INTERACTION_TOKEN, '@original'));
const contentOf = (call: RestCall | undefined) => (call?.body as { content?: string } | undefined)?.content ?? '';
const characterNamed = (firstName: string) => prisma.character.findFirstOrThrow({ where: { firstName } });

beforeAll(async () => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  discord = new FakeDiscordClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(loadConfig(process.env))] })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(discord)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(nest);
  app = nest;
  await app.init();
  prisma = app.get(PrismaService);
  ctx = { get: (token) => app.get(token, { strict: false }) };
});

beforeEach(async () => {
  nock.cleanAll();
  discord.rest.reset();
  mockRealm();
  await prisma.$executeRawUnsafe('TRUNCATE guild_config, player, "character", oauth_state, bnet_token RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  nock.cleanAll();
  nock.enableNetConnect();
  await app.close();
});

describe('/lier battlenet (e2e)', () => {
  it('stores only the SHA-256 of a 32-byte state, valid 10 minutes, tied to the member, server, region and interaction', async () => {
    const before = Date.now();
    const state = await startLink();

    expect(Buffer.from(state, 'base64url')).toHaveLength(32);
    const [row] = await prisma.oauthState.findMany();
    expect(row).toMatchObject({
      stateSha256: sha256Hex(state),
      ownerId: USER,
      guildId: GUILD,
      region: 'eu',
      interactionToken: INTERACTION_TOKEN,
      usedAt: null,
    });
    expect(OAUTH_STATE_TTL_SEC).toBe(600);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(JSON.stringify(row)).not.toContain(state);
    // Using /lier on a server shows the player there.
    expect(await prisma.membership.findMany()).toEqual([{ guildId: GUILD, discordUserId: USER }]);
  });
});

describe('GET /oauth/bnet/callback (e2e)', () => {
  it('success: verifies the member’s characters, creates unknown ones untracked, edits the reply with two menus, keeps no token', async () => {
    await prisma.player.create({ data: { discordUserId: USER } });
    await prisma.character.create({ data: { region: 'eu', firstName: 'Davina', surname: 'Asaria', ownerId: USER, role: 'main' } });
    const state = await startLink();
    const exchange = mockCodeExchange();
    const profile = mockProfile();

    const res = await callback({ code: 'the-code', state }).expect(200);

    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Liaison réussie, retourne sur Discord');
    expect(exchange.isDone() && profile.isDone()).toBe(true);

    expect(await characterNamed('Davina')).toMatchObject({
      ownerId: USER,
      role: 'main',
      bnetVerified: true,
      classFile: 'PRIEST',
      raceFile: 'Troll',
      faction: 'Horde',
      realmName: 'CAMWOW EU5 Realm 1 PvE',
      ruleset: 'NORMAL',
    });
    expect(await characterNamed('Kael')).toMatchObject({
      region: 'eu',
      surname: 'Ombre',
      ownerId: USER,
      role: 'untracked',
      bnetVerified: true,
      classFile: 'MAGE',
    });

    const [edit] = webhookEdits();
    expect(contentOf(edit)).toContain('**Davina Asaria** · niv. 23 · principal');
    expect(contentOf(edit)).toContain('**Kael Ombre** · niv. 5 · non suivi');
    const rows = (edit.body as { components: Array<{ components: Array<{ custom_id: string }> }> }).components;
    expect(rows.map((r) => r.components[0].custom_id)).toEqual([BNET_SELECT_IDS.main, BNET_SELECT_IDS.alt]);

    expect((await prisma.oauthState.findFirstOrThrow()).usedAt).toBeInstanceOf(Date);
    // App mode (S-17): the player token is thrown away at the end of the callback.
    expect(await prisma.bnetToken.count()).toBe(0);
  });

  it('the « secondaire » menu then makes the chosen character alt', async () => {
    const state = await startLink();
    mockCodeExchange();
    mockProfile();
    await callback({ code: 'the-code', state }).expect(200);
    const kael = await characterNamed('Kael');
    const editReply = jest.fn().mockResolvedValue(undefined);

    await altMenu.execute(
      { user: { id: USER }, values: [kael.id.toString()], isStringSelectMenu: () => true, deferReply: jest.fn(), editReply } as never,
      ctx,
    );

    expect((await characterNamed('Kael')).role).toBe('alt');
    expect(editReply).toHaveBeenCalledWith({ content: expect.stringContaining('est maintenant ton perso secondaire') as string });
  });

  it('404 account profile: help message on the page and in Discord, nothing created', async () => {
    const state = await startLink();
    mockCodeExchange();
    mockProfile(404, fixture('account-profile.404.json'));

    const res = await callback({ code: 'the-code', state }).expect(200);

    expect(res.text).toContain(NO_FOREVER_CHARACTER_HELP);
    expect(contentOf(webhookEdits()[0])).toBe(`❌ ${NO_FOREVER_CHARACTER_HELP}`);
    expect(await prisma.character.count()).toBe(0);
  });

  it('expired state: error page inviting to run /lier battlenet again, Battle.net never called', async () => {
    await prisma.player.create({ data: { discordUserId: USER } });
    await prisma.oauthState.create({
      data: {
        stateSha256: sha256Hex('old-state'),
        ownerId: USER,
        guildId: GUILD,
        region: 'eu',
        interactionToken: INTERACTION_TOKEN,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    const exchange = mockCodeExchange();

    const res = await callback({ code: 'the-code', state: 'old-state' }).expect(400);

    expect(res.text).toMatch(/expiré/);
    expect(res.text).toContain('/lier battlenet');
    expect(exchange.isDone()).toBe(false);
    expect(discord.rest.calls).toEqual([]);
  });

  it('reused state: the second use gets the error page and changes nothing', async () => {
    const state = await startLink();
    mockCodeExchange();
    mockProfile();
    await callback({ code: 'the-code', state }).expect(200);
    const charactersBefore = await prisma.character.findMany({ orderBy: { id: 'asc' } });
    discord.rest.reset();
    const exchange = mockCodeExchange();

    const res = await callback({ code: 'the-code', state }).expect(400);

    expect(res.text).toMatch(/déjà été utilisé/);
    expect(exchange.isDone()).toBe(false);
    expect(await prisma.character.findMany({ orderBy: { id: 'asc' } })).toEqual(charactersBefore);
    expect(discord.rest.calls).toEqual([]);
  });

  it('unknown or missing state: error page', async () => {
    expect((await callback({ code: 'the-code', state: 'never-issued' }).expect(400)).text).toContain('/lier battlenet');
    await callback({ code: 'the-code' }).expect(400);
  });

  it('character owned by another unverified member: transferred to this member and reported in the logs channels', async () => {
    await prisma.guildConfig.create({ data: { guildId: GUILD, logsChannelId: 'logs-1' } });
    await prisma.guildConfig.create({ data: { guildId: GUILD2, logsChannelId: 'logs-2' } });
    await prisma.player.create({ data: { discordUserId: OTHER, memberships: { create: [{ guildId: GUILD2 }] } } });
    await prisma.character.create({ data: { region: 'eu', firstName: 'Davina', surname: 'Asaria', ownerId: OTHER, role: 'main' } });
    const state = await startLink();
    mockCodeExchange();
    mockProfile();

    await callback({ code: 'the-code', state }).expect(200);

    expect(await characterNamed('Davina')).toMatchObject({ ownerId: USER, role: 'untracked', bnetVerified: true });
    const notices = discord.rest.calls.filter((c) => c.method === 'post' && c.route.endsWith('/messages'));
    expect(notices.map((c) => c.route).sort()).toEqual([Routes.channelMessages('logs-1'), Routes.channelMessages('logs-2')]);
    expect(contentOf(notices[0])).toContain(`appartenait à <@${OTHER}> sans vérification ; il passe à <@${USER}>`);
    expect(notices[0].body).toMatchObject({ allowed_mentions: { parse: [] } });
    expect(contentOf(webhookEdits()[0])).toContain('**Davina Asaria** · niv. 23 · non suivi · repris à un autre membre');
  });

  it('character owned by another verified member: left alone and shown as such', async () => {
    await prisma.player.create({ data: { discordUserId: OTHER } });
    await prisma.character.create({
      data: { region: 'eu', firstName: 'Davina', surname: 'Asaria', ownerId: OTHER, role: 'main', bnetVerified: true },
    });
    const state = await startLink();
    mockCodeExchange();
    mockProfile();

    await callback({ code: 'the-code', state }).expect(200);

    expect(await characterNamed('Davina')).toMatchObject({ ownerId: OTHER, role: 'main' });
    expect(contentOf(webhookEdits()[0])).toContain('appartient à un autre membre vérifié');
  });

  it('401 on the profile: retried once, then succeeds', async () => {
    const state = await startLink();
    mockCodeExchange();
    mockProfile(401, {});
    mockProfile();

    await callback({ code: 'the-code', state }).expect(200);

    expect(await prisma.character.count()).toBe(2);
  });

  it('403 twice: generic error on the page and in Discord', async () => {
    const state = await startLink();
    mockCodeExchange();
    const profiles = [mockProfile(403, {}), mockProfile(403, {})];

    const res = await callback({ code: 'the-code', state }).expect(502);

    expect(profiles.every((p) => p.isDone())).toBe(true);
    expect(res.text).toContain('/lier battlenet');
    expect(contentOf(webhookEdits()[0])).toBe(BNET_LINK_MSG.failed);
    expect(await prisma.character.count()).toBe(0);
  });

  it('code refused by Battle.net: generic error', async () => {
    const state = await startLink();
    nock(OAUTH).post('/token', /authorization_code/).reply(400, { error: 'invalid_grant' });

    await callback({ code: 'the-code', state }).expect(502);

    expect(contentOf(webhookEdits()[0])).toBe(BNET_LINK_MSG.failed);
  });

  it('authorization refused by the member on Battle.net: its own page and message', async () => {
    const state = await startLink();

    const res = await callback({ error: 'access_denied', state }).expect(200);

    expect(res.text).toMatch(/annulée/);
    expect(contentOf(webhookEdits()[0])).toBe(BNET_LINK_MSG.denied);
  });

  it('expired interaction: the result goes to the member by direct message', async () => {
    const state = await startLink();
    mockCodeExchange();
    mockProfile();
    discord.rest.failWebhookEdits = true;

    await callback({ code: 'the-code', state }).expect(200);

    expect(discord.rest.calls).toContainEqual({ method: 'post', route: Routes.userChannels(), body: { recipient_id: USER } });
    const dm = discord.rest.calls.find((c) => c.route === Routes.channelMessages(`dm-${USER}`));
    expect(contentOf(dm)).toContain(BNET_LINK_MSG.expiredIntro);
    expect(contentOf(dm)).toContain('**Davina Asaria**');
  });
});
