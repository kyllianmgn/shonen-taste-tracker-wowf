import type { AppConfig } from '../src/common/config/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CharacterService } from '../src/core/characters/character.service';
import type { AddCharacterInput, TrackedRole } from '../src/core/characters/character.types';
import { TEST_DATABASE_URL } from './test-database';

const prisma = new PrismaService({ databaseUrl: TEST_DATABASE_URL } as AppConfig);
const service = new CharacterService(prisma);

const ME = '300000000000000001';
const OTHER = '300000000000000002';
const GUILD = '600000000000000001';
const GUILD_2 = '600000000000000002';

function add(firstName: string, surname: string, extra: Partial<AddCharacterInput> = {}) {
  return service.add({ ownerId: ME, guildId: GUILD, region: 'eu', firstName, surname, ...extra });
}

/** Character rows by names, for assertions on what is stored. */
function stored(firstName: string, surname: string, region = 'eu') {
  return prisma.character.findFirst({ where: { region, firstName, surname } });
}

async function seed(ownerId: string | null, firstName: string, surname: string, role: TrackedRole | 'untracked' | null) {
  if (ownerId) await prisma.player.upsert({ where: { discordUserId: ownerId }, create: { discordUserId: ownerId }, update: {} });
  return prisma.character.create({ data: { region: 'eu', firstName, surname, ownerId, role } });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, character, device, pairing_code, snapshot, game_session, game_event, bnet_token, oauth_state RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CharacterService (e2e)', () => {
  describe('add', () => {
    it('creates the character as main, with the player, the guild row and the membership', async () => {
      const result = await add('Davina', 'Asaria');

      expect(result).toMatchObject({ status: 'added', role: 'main', created: true });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ ownerId: ME, role: 'main' });
      await expect(prisma.player.findUnique({ where: { discordUserId: ME } })).resolves.not.toBeNull();
      await expect(prisma.guildConfig.findUnique({ where: { guildId: GUILD } })).resolves.toMatchObject({
        boardSort: 'level',
      });
      await expect(
        prisma.membership.findUnique({ where: { guildId_discordUserId: { guildId: GUILD, discordUserId: ME } } }),
      ).resolves.not.toBeNull();
    });

    it('gives the first free role when none is asked: main, then secondary', async () => {
      await add('Davina', 'Asaria');
      const second = await add('Borek', 'Tanu');

      expect(second).toMatchObject({ status: 'added', role: 'alt' });
    });

    it('takes the asked role when it is free', async () => {
      const result = await add('Borek', 'Tanu', { role: 'alt' });

      expect(result).toMatchObject({ status: 'added', role: 'alt' });
      await expect(add('Davina', 'Asaria')).resolves.toMatchObject({ status: 'added', role: 'main' });
    });

    it('refuses a 3rd tracked character and creates nothing', async () => {
      await add('Davina', 'Asaria');
      await add('Borek', 'Tanu');

      const third = await add('Celia', 'Morn');

      expect(third).toMatchObject({ status: 'too_many' });
      if (third.status !== 'too_many') throw new Error('unreachable');
      expect(third.tracked.map((c) => [c.firstName, c.role])).toEqual([
        ['Davina', 'main'],
        ['Borek', 'alt'],
      ]);
      await expect(prisma.character.count()).resolves.toBe(2);
    });

    it('refuses a 3rd character even with a role asked', async () => {
      await add('Davina', 'Asaria');
      await add('Borek', 'Tanu');

      await expect(add('Celia', 'Morn', { role: 'main' })).resolves.toMatchObject({ status: 'too_many' });
    });

    it('refuses a taken main and names the current one', async () => {
      await add('Davina', 'Asaria');

      const result = await add('Borek', 'Tanu', { role: 'main' });

      expect(result).toMatchObject({
        status: 'role_taken',
        role: 'main',
        character: { firstName: 'Borek', surname: 'Tanu', region: 'eu' },
        holder: { firstName: 'Davina', surname: 'Asaria' },
      });
      await expect(stored('Borek', 'Tanu')).resolves.toBeNull();
    });

    it('refuses a taken secondary', async () => {
      await add('Borek', 'Tanu', { role: 'alt' });

      await expect(add('Davina', 'Asaria', { role: 'alt' })).resolves.toMatchObject({
        status: 'role_taken',
        role: 'alt',
        holder: { firstName: 'Borek' },
      });
    });

    it('refuses a character tracked by another member, and adds no membership', async () => {
      await seed(OTHER, 'Davina', 'Asaria', 'main');

      const result = await add('Davina', 'Asaria');

      expect(result).toMatchObject({ status: 'owned_by_other', character: { firstName: 'Davina' } });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ ownerId: OTHER, role: 'main' });
      await expect(prisma.membership.count()).resolves.toBe(0);
    });

    it('refuses a character another member owns but no longer tracks', async () => {
      await seed(OTHER, 'Davina', 'Asaria', 'untracked');

      await expect(add('Davina', 'Asaria')).resolves.toMatchObject({ status: 'owned_by_other' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ ownerId: OTHER });
    });

    it('attaches an ownerless character found case-insensitively, keeping its id and stored names', async () => {
      const orphan = await seed(null, 'Davina', 'Asaria', 'untracked');

      const result = await add('DAVINA', 'asaria');

      expect(result).toMatchObject({ status: 'added', role: 'main', created: false, character: { id: orphan.id } });
      await expect(prisma.character.findUnique({ where: { id: orphan.id } })).resolves.toMatchObject({
        ownerId: ME,
        role: 'main',
        firstName: 'Davina',
        surname: 'Asaria',
      });
      await expect(prisma.character.count()).resolves.toBe(1);
    });

    it('finds another member’s character whatever the case typed', async () => {
      await seed(OTHER, 'Davina', 'Asaria', 'main');

      await expect(add('dAvInA', 'ASARIA')).resolves.toMatchObject({ status: 'owned_by_other' });
    });

    it('stores normalized names: trimmed, capitalized', async () => {
      await add('  dAVINA ', 'asARIA');

      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ ownerId: ME });
    });

    it('keeps the same names apart in another region', async () => {
      await seed(OTHER, 'Davina', 'Asaria', 'main');

      await expect(add('Davina', 'Asaria', { region: 'us' })).resolves.toMatchObject({ status: 'added', created: true });
      await expect(stored('Davina', 'Asaria', 'us')).resolves.toMatchObject({ ownerId: ME });
    });

    it('refuses invalid names without touching the database', async () => {
      await expect(add('D', 'Asaria')).resolves.toEqual({ status: 'invalid_name' });
      await expect(add('Davina', 'Asaria2')).resolves.toEqual({ status: 'invalid_name' });
      await expect(prisma.player.count()).resolves.toBe(0);
    });

    it('answers « already tracked » for the member’s own character and adds the membership of this guild', async () => {
      await add('Davina', 'Asaria');

      const again = await add('davina', 'asaria', { guildId: GUILD_2, role: 'alt' });

      expect(again).toMatchObject({ status: 'already_tracked', role: 'main' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'main' });
      await expect(prisma.membership.count({ where: { discordUserId: ME } })).resolves.toBe(2);
    });

    it('tracks again one of the member’s untracked characters', async () => {
      const mine = await seed(ME, 'Davina', 'Asaria', 'untracked');

      await expect(add('Davina', 'Asaria', { role: 'alt' })).resolves.toMatchObject({
        status: 'added',
        role: 'alt',
        created: false,
        character: { id: mine.id },
      });
    });

    it('never touches the settings of an existing guild row', async () => {
      await prisma.guildConfig.create({ data: { guildId: GUILD, boardSort: 'name', levelAnnounceStep: 10 } });

      await add('Davina', 'Asaria');

      await expect(prisma.guildConfig.findUnique({ where: { guildId: GUILD } })).resolves.toMatchObject({
        boardSort: 'name',
        levelAnnounceStep: 10,
      });
    });

    it('gives a new character to one member only when two add it at the same time', async () => {
      const results = await Promise.all([
        service.add({ ownerId: ME, guildId: GUILD, region: 'eu', firstName: 'Davina', surname: 'Asaria' }),
        service.add({ ownerId: OTHER, guildId: GUILD, region: 'eu', firstName: 'davina', surname: 'ASARIA' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(['added', 'owned_by_other']);
      await expect(prisma.character.count()).resolves.toBe(1);
    });

    it('hands out main and secondary when a member adds two characters at the same time', async () => {
      const results = await Promise.all([add('Davina', 'Asaria'), add('Borek', 'Tanu')]);

      expect(results.map((r) => (r.status === 'added' ? r.role : r.status)).sort()).toEqual(['alt', 'main']);
    });
  });

  describe('setMain', () => {
    it('swaps main and secondary', async () => {
      const davina = await add('Davina', 'Asaria');
      const borek = await add('Borek', 'Tanu');
      if (davina.status !== 'added' || borek.status !== 'added') throw new Error('setup failed');

      const result = await service.setMain(ME, borek.character.id);

      expect(result).toMatchObject({
        status: 'promoted',
        character: { firstName: 'Borek' },
        demoted: { firstName: 'Davina' },
      });
      await expect(stored('Borek', 'Tanu')).resolves.toMatchObject({ role: 'main' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'alt' });
    });

    it('promotes the secondary when there is no main', async () => {
      const borek = await add('Borek', 'Tanu', { role: 'alt' });
      if (borek.status !== 'added') throw new Error('setup failed');

      await expect(service.setMain(ME, borek.character.id)).resolves.toMatchObject({ status: 'promoted', demoted: null });
      await expect(stored('Borek', 'Tanu')).resolves.toMatchObject({ role: 'main' });
    });

    it('promotes an untracked character and moves the main to secondary when it is free', async () => {
      await add('Davina', 'Asaria');
      const oldie = await seed(ME, 'Oldie', 'Tanu', 'untracked');

      await expect(service.setMain(ME, oldie.id)).resolves.toMatchObject({
        status: 'promoted',
        demoted: { firstName: 'Davina' },
      });
      await expect(stored('Oldie', 'Tanu')).resolves.toMatchObject({ role: 'main' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'alt' });
    });

    it('promotes an untracked character when nothing is tracked', async () => {
      const oldie = await seed(ME, 'Oldie', 'Tanu', 'untracked');

      await expect(service.setMain(ME, oldie.id)).resolves.toMatchObject({ status: 'promoted', demoted: null });
    });

    it('refuses to promote an untracked character over a main and a secondary', async () => {
      await add('Davina', 'Asaria');
      await add('Borek', 'Tanu');
      const oldie = await seed(ME, 'Oldie', 'Tanu', 'untracked');

      const result = await service.setMain(ME, oldie.id);

      expect(result).toMatchObject({ status: 'too_many', character: { firstName: 'Oldie' } });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'main' });
      await expect(stored('Borek', 'Tanu')).resolves.toMatchObject({ role: 'alt' });
      await expect(stored('Oldie', 'Tanu')).resolves.toMatchObject({ role: 'untracked' });
    });

    it('answers « already main »', async () => {
      const davina = await add('Davina', 'Asaria');
      if (davina.status !== 'added') throw new Error('setup failed');

      await expect(service.setMain(ME, davina.character.id)).resolves.toMatchObject({ status: 'already_main' });
    });

    it('does not find another member’s character or an unknown id', async () => {
      const theirs = await seed(OTHER, 'Davina', 'Asaria', 'alt');

      await expect(service.setMain(ME, theirs.id)).resolves.toEqual({ status: 'not_found' });
      await expect(service.setMain(ME, 999n)).resolves.toEqual({ status: 'not_found' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'alt' });
    });
  });

  describe('setAlt', () => {
    it('makes an untracked character alt when the slot is free', async () => {
      await seed(ME, 'Davina', 'Asaria', 'main');
      const borek = await seed(ME, 'Borek', 'Tanu', 'untracked');

      await expect(service.setAlt(ME, borek.id)).resolves.toMatchObject({ status: 'set', replaced: null });
      await expect(stored('Borek', 'Tanu')).resolves.toMatchObject({ role: 'alt' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'main' });
    });

    it('replaces the former alt, which becomes untracked', async () => {
      await seed(ME, 'Davina', 'Asaria', 'alt');
      const borek = await seed(ME, 'Borek', 'Tanu', 'untracked');

      const result = await service.setAlt(ME, borek.id);

      expect(result).toMatchObject({ status: 'set', replaced: { firstName: 'Davina' } });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'untracked', ownerId: ME });
      await expect(stored('Borek', 'Tanu')).resolves.toMatchObject({ role: 'alt' });
    });

    it('refuses the main and says when the character is already alt', async () => {
      const davina = await seed(ME, 'Davina', 'Asaria', 'main');
      const borek = await seed(ME, 'Borek', 'Tanu', 'alt');

      await expect(service.setAlt(ME, davina.id)).resolves.toMatchObject({ status: 'is_main' });
      await expect(service.setAlt(ME, borek.id)).resolves.toMatchObject({ status: 'already_alt' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'main' });
    });

    it('does not find another member’s character', async () => {
      const theirs = await seed(OTHER, 'Celia', 'Morn', 'untracked');

      await expect(service.setAlt(ME, theirs.id)).resolves.toEqual({ status: 'not_found' });
    });
  });

  describe('linkFromBnet', () => {
    const data = (firstName: string, surname: string) => ({
      firstName,
      surname,
      classFile: 'PRIEST',
      raceFile: null,
      faction: 'Horde' as const,
      realmName: 'Royaume',
      ruleset: 'NORMAL',
    });

    it('verifies, claims, creates, transfers or leaves each character, and keeps stored names and roles', async () => {
      await seed(ME, 'Davina', 'Asaria', 'main');
      await seed(null, 'Orphe', 'Lin', null);
      await seed(OTHER, 'Mira', 'Sol', 'alt');
      const verified = await seed(OTHER, 'Zed', 'Vox', 'main');
      await prisma.character.update({ where: { id: verified.id }, data: { bnetVerified: true } });

      const entries = await service.linkFromBnet({
        ownerId: ME,
        region: 'eu',
        characters: [data('DAVINA', 'asaria'), data('Orphe', 'Lin'), data('Kael', 'Ombre'), data('Mira', 'Sol'), data('Zed', 'Vox')],
      });

      expect(entries.map((e) => [e.character.firstName, e.outcome, e.role, e.previousOwnerId ?? null])).toEqual([
        ['Davina', 'verified', 'main', null],
        ['Orphe', 'claimed', 'untracked', null],
        ['Kael', 'created', 'untracked', null],
        ['Mira', 'transferred', 'untracked', OTHER],
        ['Zed', 'owned_by_other', null, null],
      ]);
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({
        role: 'main',
        bnetVerified: true,
        classFile: 'PRIEST',
        faction: 'Horde',
        realmName: 'Royaume',
        ruleset: 'NORMAL',
      });
      await expect(stored('Mira', 'Sol')).resolves.toMatchObject({ ownerId: ME, role: 'untracked', bnetVerified: true });
      await expect(stored('Zed', 'Vox')).resolves.toMatchObject({ ownerId: OTHER, role: 'main', classFile: null });
      await expect(stored('Kael', 'Ombre')).resolves.toMatchObject({ ownerId: ME, bnetVerified: true });
    });

    it('never overwrites known data with null', async () => {
      const davina = await seed(ME, 'Davina', 'Asaria', 'main');
      await prisma.character.update({ where: { id: davina.id }, data: { raceFile: 'Troll' } });

      await service.linkFromBnet({ ownerId: ME, region: 'eu', characters: [data('Davina', 'Asaria')] });

      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ raceFile: 'Troll' });
    });
  });

  describe('untrack', () => {
    it('moves the character to untracked, keeps its owner and frees the role', async () => {
      const davina = await add('Davina', 'Asaria');
      await add('Borek', 'Tanu');
      if (davina.status !== 'added') throw new Error('setup failed');

      await expect(service.untrack(ME, davina.character.id)).resolves.toMatchObject({
        status: 'untracked',
        character: { firstName: 'Davina' },
      });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ ownerId: ME, role: 'untracked' });
      await expect(add('Celia', 'Morn')).resolves.toMatchObject({ status: 'added', role: 'main' });
    });

    it('answers « already untracked »', async () => {
      const oldie = await seed(ME, 'Oldie', 'Tanu', 'untracked');

      await expect(service.untrack(ME, oldie.id)).resolves.toMatchObject({ status: 'already_untracked' });
    });

    it('does not find another member’s character', async () => {
      const theirs = await seed(OTHER, 'Davina', 'Asaria', 'main');

      await expect(service.untrack(ME, theirs.id)).resolves.toEqual({ status: 'not_found' });
      await expect(stored('Davina', 'Asaria')).resolves.toMatchObject({ role: 'main' });
    });
  });

  describe('list', () => {
    it('lists main, secondary then untracked, with last sync and Battle.net check', async () => {
      const oldie = await seed(ME, 'Oldie', 'Tanu', 'untracked');
      await add('Borek', 'Tanu', { role: 'alt' });
      const davina = await add('Davina', 'Asaria');
      if (davina.status !== 'added') throw new Error('setup failed');
      const receivedAt = new Date('2026-11-01T20:00:00Z');
      const snapshot = await prisma.snapshot.create({
        data: { characterId: davina.character.id, capturedAt: receivedAt, receivedAt, level: 12, detail: {} },
      });
      await prisma.character.update({
        where: { id: davina.character.id },
        data: { lastSnapshotId: snapshot.id, bnetVerified: true },
      });

      const list = await service.list(ME);

      expect(list.map((c) => [c.firstName, c.role, c.bnetVerified, c.lastSyncAt])).toEqual([
        ['Davina', 'main', true, receivedAt],
        ['Borek', 'alt', false, null],
        ['Oldie', 'untracked', false, null],
      ]);
      expect(list[2].id).toBe(oldie.id);
    });

    it('is empty for a member without characters', async () => {
      await expect(service.list(ME)).resolves.toEqual([]);
    });
  });
});
