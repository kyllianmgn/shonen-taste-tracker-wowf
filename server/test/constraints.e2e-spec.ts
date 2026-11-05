import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { TEST_DATABASE_URL } from './test-database';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) });

const OWNER = '200000000000000001';
const OTHER = '200000000000000002';

function character(overrides: Partial<Prisma.CharacterUncheckedCreateInput> = {}) {
  return prisma.character.create({
    data: { region: 'eu', firstName: 'Davina', surname: 'Asaria', ...overrides },
  });
}

/** Classifies the failure of a write: 'unique' (Postgres 23505), 'check' (23514) or 'other'. */
async function violation(write: Promise<unknown>): Promise<'unique' | 'check' | 'other' | 'none'> {
  try {
    await write;
  } catch (e) {
    const text = `${(e as Error).message} ${JSON.stringify(e)}`;
    if (/23505|unique constraint/i.test(text)) return 'unique';
    if (/23514|check constraint/i.test(text)) return 'check';
    return 'other';
  }
  return 'none';
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, character, device, pairing_code, snapshot, game_session, game_event, bnet_token, oauth_state RESTART IDENTITY CASCADE',
  );
  await prisma.player.createMany({ data: [{ discordUserId: OWNER }, { discordUserId: OTHER }] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('database constraints (e2e)', () => {
  describe('character identity', () => {
    it('refuses the same region and names, ignoring case', async () => {
      await character();

      expect(await violation(character({ firstName: 'DAVINA', surname: 'asaria' }))).toBe('unique');
    });

    it('accepts the same names in another region', async () => {
      await character();

      expect(await violation(character({ region: 'us' }))).toBe('none');
    });
  });

  describe('main and alt per owner', () => {
    it('refuses a second main for the same owner', async () => {
      await character({ ownerId: OWNER, role: 'main' });

      expect(await violation(character({ firstName: 'Other', ownerId: OWNER, role: 'main' }))).toBe('unique');
    });

    it('refuses a second alt for the same owner', async () => {
      await character({ ownerId: OWNER, role: 'alt' });

      expect(await violation(character({ firstName: 'Other', ownerId: OWNER, role: 'alt' }))).toBe('unique');
    });

    it('accepts one main, one alt and several untracked per owner', async () => {
      await character({ firstName: 'Aa', ownerId: OWNER, role: 'main' });
      await character({ firstName: 'Bb', ownerId: OWNER, role: 'alt' });
      await character({ firstName: 'Cc', ownerId: OWNER, role: 'untracked' });
      await character({ firstName: 'Dd', ownerId: OWNER, role: 'untracked' });

      expect(await prisma.character.count({ where: { ownerId: OWNER } })).toBe(4);
    });

    it('lets two owners each have a main, and keeps orphans unconstrained', async () => {
      await character({ firstName: 'Aa', ownerId: OWNER, role: 'main' });
      await character({ firstName: 'Bb', ownerId: OTHER, role: 'main' });
      await character({ firstName: 'Cc', role: 'untracked' });
      await character({ firstName: 'Dd', role: 'untracked' });

      expect(await prisma.character.count()).toBe(4);
    });

    it('refuses an unknown role', async () => {
      expect(await violation(character({ role: 'leader' }))).toBe('check');
    });
  });

  it('refuses a duplicate event id for the same character', async () => {
    const { id } = await character();
    const event = {
      characterId: id,
      eventId: 'Player-4242-0A1B2C3D-1793899800-2',
      type: 'LEVEL_UP',
      at: new Date(),
      data: {},
    };
    await prisma.gameEvent.create({ data: event });

    expect(await violation(prisma.gameEvent.create({ data: event }))).toBe('unique');
  });

  it('refuses two devices with the same token hash', async () => {
    const device = { ownerId: OWNER, tokenSha256: 'a'.repeat(64) };
    await prisma.device.create({ data: device });

    expect(await violation(prisma.device.create({ data: { ...device, ownerId: OTHER } }))).toBe('unique');
  });
});
