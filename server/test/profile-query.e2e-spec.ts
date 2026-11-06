import type { AppConfig } from '../src/common/config/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ProfileQueryService } from '../src/discord/profile/profile-query.service';
import { TEST_DATABASE_URL } from './test-database';

const prisma = new PrismaService({ databaseUrl: TEST_DATABASE_URL } as AppConfig);
const service = new ProfileQueryService(prisma);

const ME = '300000000000000001';
const OTHER = '300000000000000002';
const OUTSIDER = '300000000000000003';
const GUILD = '600000000000000001';
const GUILD_2 = '600000000000000002';

const at = (unix: number) => new Date(unix * 1000);

async function player(id: string, guilds: string[], privacy: { hideMoney?: boolean; hideZone?: boolean; hidePresence?: boolean } = {}) {
  await prisma.player.create({ data: { discordUserId: id, ...privacy } });
  for (const guildId of guilds) {
    await prisma.guildConfig.upsert({ where: { guildId }, create: { guildId }, update: {} });
    await prisma.membership.create({ data: { guildId, discordUserId: id } });
  }
}

async function character(ownerId: string, firstName: string, role: 'main' | 'alt' | 'untracked', classFile: string | null = 'PRIEST') {
  return prisma.character.create({ data: { region: 'eu', firstName, surname: 'Asaria', ownerId, role, classFile } });
}

async function snapshot(characterId: bigint, capturedAt: number, fields: Record<string, unknown> = {}, detail: object = {}) {
  const row = await prisma.snapshot.create({
    data: {
      characterId,
      capturedAt: at(capturedAt),
      level: 23,
      xp: 4120,
      xpMax: 13600,
      money: 384512n,
      playedTotal: 81234,
      zone: 'Duskwood',
      subZone: 'Darkshire',
      detail,
      receivedAt: at(capturedAt + 5),
      ...fields,
    },
  });
  await prisma.character.update({ where: { id: characterId }, data: { lastSnapshotId: row.id } });
  return row;
}

async function event(characterId: bigint, type: string, unix: number, data: object, flags: string[] = []) {
  await prisma.gameEvent.create({ data: { characterId, eventId: `${type}-${unix}-${Math.random()}`, type, at: at(unix), data, flags } });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, character, device, pairing_code, snapshot, game_session, game_event, bnet_token, oauth_state RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ProfileQueryService (e2e)', () => {
  describe('isMember', () => {
    it('is true only for a member of this guild', async () => {
      await player(ME, [GUILD]);
      await player(OUTSIDER, [GUILD_2]);

      await expect(service.isMember(GUILD, ME)).resolves.toBe(true);
      await expect(service.isMember(GUILD, OUTSIDER)).resolves.toBe(false);
      await expect(service.isMember(GUILD, '300000000000000999')).resolves.toBe(false);
    });
  });

  describe('profile', () => {
    it('maps the character, its last snapshot, its detail and its 10 last unflagged level-ups', async () => {
      await player(ME, [GUILD], { hideZone: true });
      const davina = await character(ME, 'Davina', 'main');
      await snapshot(davina.id, 1793800000, { level: 22 });
      await snapshot(
        davina.id,
        1793900000,
        {},
        {
          guild: 'Les Veilleurs',
          guildRank: 'Membre',
          ilvl: 21,
          deaths: 4,
          professions: [{ name: 'Herboristerie', rank: 112, max: 150 }, { rank: 3 }],
          reputations: [{ factionId: 76, name: 'Orgrimmar', standing: 6 }, { factionId: 1, standing: 8 }],
        },
      );
      for (let level = 2; level <= 23; level += 1) await event(davina.id, 'LEVEL_UP', 1793000000 + level * 1000, { level });
      await event(davina.id, 'LEVEL_UP', 1793999999, { level: 40 }, ['suspect_level_jump']);
      await event(davina.id, 'DEATH', 1793999000, { level: 23 });

      const input = await service.profile(ME, davina.id);

      expect(input).toEqual({
        discordUserId: ME,
        privacy: { hideMoney: false, hideZone: true, hidePresence: false },
        character: { firstName: 'Davina', surname: 'Asaria', classFile: 'PRIEST', role: 'main' },
        snapshot: {
          level: 23,
          xp: 4120,
          xpMax: 13600,
          money: 384512n,
          playedTotal: 81234,
          zone: 'Duskwood',
          subZone: 'Darkshire',
          receivedAt: at(1793900005),
          detail: {
            guild: 'Les Veilleurs',
            guildRank: 'Membre',
            ilvl: 21,
            professions: [{ name: 'Herboristerie', rank: 112, max: 150 }],
            reputations: [{ name: 'Orgrimmar', standing: 6 }],
          },
        },
        levels: Array.from({ length: 10 }, (_, i) => ({ level: 23 - i, at: at(1793000000 + (23 - i) * 1000) })),
      });
    });

    it('gives a null snapshot for a character never synchronized', async () => {
      await player(ME, [GUILD]);
      const davina = await character(ME, 'Davina', 'alt', null);

      await expect(service.profile(ME, davina.id)).resolves.toMatchObject({
        character: { role: 'alt', classFile: null },
        snapshot: null,
        levels: [],
      });
    });

    it('is null for an untracked character or one of another member', async () => {
      await player(ME, [GUILD]);
      await player(OTHER, [GUILD]);
      const old = await character(ME, 'Davina', 'untracked');
      const theirs = await character(OTHER, 'Brom', 'main');

      await expect(service.profile(ME, old.id)).resolves.toBeNull();
      await expect(service.profile(ME, theirs.id)).resolves.toBeNull();
    });
  });

  describe('session', () => {
    async function session(fields: { characterId?: bigint | null; startedAt: number; endedAt?: number | null } & Record<string, unknown>) {
      const { startedAt, endedAt, ...rest } = fields;
      return prisma.gameSession.create({
        data: { ownerId: ME, startedAt: at(startedAt), endedAt: endedAt ? at(endedAt) : null, ...rest },
      });
    }

    it('gives the session in progress first, with the deaths and the zone up to now', async () => {
      await player(ME, [GUILD]);
      const davina = await character(ME, 'Davina', 'main');
      await session({ characterId: davina.id, startedAt: 1793800000, endedAt: 1793805000, levelStart: 20, levelEnd: 21 });
      await session({ characterId: davina.id, startedAt: 1793890000, levelStart: 21, levelEnd: 22, moneyStart: 10n, moneyEnd: 50n });
      await snapshot(davina.id, 1793895000, { zone: 'Elwynn', subZone: null });
      await event(davina.id, 'DEATH', 1793891000, { level: 21 });
      await event(davina.id, 'DEATH', 1793892000, { level: 21 });
      await event(davina.id, 'DEATH', 1793893000, { level: 21 }, ['late']);
      await event(davina.id, 'DEATH', 1793801000, { level: 20 }); // previous session

      await expect(service.session(ME, at(1793896000))).resolves.toEqual({
        discordUserId: ME,
        privacy: { hideMoney: false, hideZone: false, hidePresence: false },
        character: { firstName: 'Davina', surname: 'Asaria' },
        startedAt: at(1793890000),
        endedAt: null,
        levelStart: 21,
        levelEnd: 22,
        moneyStart: 10n,
        moneyEnd: 50n,
        playedStart: null,
        playedEnd: null,
        zone: 'Elwynn',
        subZone: null,
        deaths: 2,
      });
    });

    it('gives the last ended session otherwise, skipping the trivial ones, with the zone of its last snapshot', async () => {
      await player(ME, [GUILD]);
      const davina = await character(ME, 'Davina', 'main');
      await session({ characterId: davina.id, startedAt: 1793800000, endedAt: 1793808000, levelStart: 20, levelEnd: 21 });
      await snapshot(davina.id, 1793807000, { zone: 'Duskwood', subZone: 'Darkshire' });
      await snapshot(davina.id, 1793850000, { zone: 'Tanaris', subZone: null }); // after the session
      // Launched and closed within 2 min without any change: no recap.
      await session({ characterId: davina.id, startedAt: 1793860000, endedAt: 1793860060, levelStart: 21, levelEnd: 21 });

      await expect(service.session(ME, at(1793900000))).resolves.toMatchObject({
        startedAt: at(1793800000),
        endedAt: at(1793808000),
        levelStart: 20,
        levelEnd: 21,
        zone: 'Duskwood',
        subZone: 'Darkshire',
        deaths: 0,
      });
    });

    it('never gives the session in progress with hide_presence', async () => {
      await player(ME, [GUILD], { hidePresence: true });
      await session({ characterId: null, startedAt: 1793800000, endedAt: 1793808000 });
      await session({ characterId: null, startedAt: 1793890000 });

      await expect(service.session(ME, at(1793896000))).resolves.toMatchObject({
        character: null,
        endedAt: at(1793808000),
        zone: null,
      });
    });

    it('is null without any session', async () => {
      await player(ME, [GUILD]);
      await expect(service.session(ME, at(1793896000))).resolves.toBeNull();
    });
  });

  describe('leaderboard', () => {
    it('lists the main character of each member of the guild with its last snapshot', async () => {
      await player(ME, [GUILD], { hideMoney: true });
      await player(OTHER, [GUILD, GUILD_2]);
      await player(OUTSIDER, [GUILD_2]);
      const davina = await character(ME, 'Davina', 'main');
      await character(ME, 'Brom', 'alt');
      await snapshot(davina.id, 1793900000, {}, { deaths: 4 });
      await character(OTHER, 'Ilsa', 'main');
      const outsider = await character(OUTSIDER, 'Zed', 'main');
      await snapshot(outsider.id, 1793900000);

      const entries = await service.leaderboard(GUILD);

      expect(entries.sort((a, b) => a.discordUserId.localeCompare(b.discordUserId))).toEqual([
        {
          discordUserId: ME,
          privacy: { hideMoney: true, hideZone: false, hidePresence: false },
          character: { firstName: 'Davina', surname: 'Asaria' },
          snapshot: { level: 23, xp: 4120, xpMax: 13600, playedTotal: 81234, money: 384512n, deaths: 4 },
        },
        {
          discordUserId: OTHER,
          privacy: { hideMoney: false, hideZone: false, hidePresence: false },
          character: { firstName: 'Ilsa', surname: 'Asaria' },
          snapshot: null,
        },
      ]);
    });
  });
});
