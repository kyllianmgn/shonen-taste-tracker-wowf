import { PrismaService } from '../src/common/prisma/prisma.service';
import type { AppConfig } from '../src/common/config/config';
import { PrismaGuildConfigStore } from '../src/discord/setup/prisma-guild-config.store';
import { TEST_DATABASE_URL } from './test-database';

const prisma = new PrismaService({ databaseUrl: TEST_DATABASE_URL } as AppConfig);
const store = new PrismaGuildConfigStore(prisma);
const GUILD = '500000000000000001';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE guild_config CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaGuildConfigStore (e2e)', () => {
  it('finds nothing for an unknown guild', async () => {
    await expect(store.find(GUILD)).resolves.toBeNull();
  });

  it('creates the row with the defaults of guild_config, then reads the channels back', async () => {
    await store.saveChannels(GUILD, { boardChannelId: 'b1', logsChannelId: 'l1', boardMessageIds: ['m1'] });

    await expect(store.find(GUILD)).resolves.toEqual({ boardChannelId: 'b1', logsChannelId: 'l1', boardMessageIds: ['m1'] });
    const row = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } });
    expect(row).toMatchObject({ levelAnnounceStep: 1, logDeaths: false, boardSort: 'level', timezone: 'Europe/Paris' });
  });

  it('updates only the channel columns of an existing row', async () => {
    await prisma.guildConfig.create({ data: { guildId: GUILD, levelAnnounceStep: 10, boardSort: 'name' } });

    await store.saveChannels(GUILD, { boardChannelId: 'b2', logsChannelId: 'l2', boardMessageIds: ['m2', 'm3'] });

    const row = await prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } });
    expect(row).toMatchObject({
      boardChannelId: 'b2',
      logsChannelId: 'l2',
      boardMessageIds: ['m2', 'm3'],
      levelAnnounceStep: 10,
      boardSort: 'name',
    });
  });
});
