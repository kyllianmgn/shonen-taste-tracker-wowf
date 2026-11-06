import type { AppConfig } from '../src/common/config/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { PrismaBoardStore } from '../src/discord/board/prisma-board.store';
import { TEST_DATABASE_URL } from './test-database';

const prisma = new PrismaService({ databaseUrl: TEST_DATABASE_URL } as AppConfig);
const store = new PrismaBoardStore(prisma, { heartbeatIntervalSec: 600 } as AppConfig);

const GUILD = '700000000000000001';
const GUILD_OFF = '700000000000000002';
const ALICE = '310000000000000001';
const BOB = '310000000000000002';
const NOW = new Date('2026-11-06T12:00:00Z');

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE guild_config, player, character, device, snapshot RESTART IDENTITY CASCADE',
  );
  await prisma.guildConfig.create({
    data: { guildId: GUILD, boardChannelId: 'b1', logsChannelId: 'l1', boardMessageIds: ['m1', 'm2'], boardSort: 'name' },
  });
  await prisma.guildConfig.create({ data: { guildId: GUILD_OFF } });
  await prisma.player.create({ data: { discordUserId: ALICE, hideZone: true } });
  await prisma.player.create({ data: { discordUserId: BOB, hidePresence: true } });
  await prisma.membership.createMany({
    data: [
      { guildId: GUILD, discordUserId: ALICE },
      { guildId: GUILD, discordUserId: BOB },
      { guildId: GUILD_OFF, discordUserId: ALICE },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaBoardStore (e2e)', () => {
  it('lists the guilds with a board channel', async () => {
    await expect(store.listBoardGuildIds()).resolves.toEqual([GUILD]);
  });

  it('finds the guilds with a board where a player is a member', async () => {
    await expect(store.guildIdsOfPlayer(ALICE)).resolves.toEqual([GUILD]);
    await expect(store.guildIdsOfPlayer('399999999999999999')).resolves.toEqual([]);
  });

  it('returns null for a guild without board or an unknown guild', async () => {
    await expect(store.load(GUILD_OFF, NOW)).resolves.toBeNull();
    await expect(store.load('799999999999999999', NOW)).resolves.toBeNull();
  });

  it('loads the board input: privacy, presence, main and alt with their latest snapshot', async () => {
    const main = await prisma.character.create({
      data: { region: 'eu', firstName: 'Davina', surname: 'Asaria', ownerId: ALICE, role: 'main', classFile: 'PRIEST' },
    });
    await prisma.character.create({ data: { region: 'eu', firstName: 'Brom', surname: 'Ferrepied', ownerId: ALICE, role: 'alt' } });
    await prisma.character.create({ data: { region: 'eu', firstName: 'Old', surname: 'Untracked', ownerId: ALICE, role: 'untracked' } });
    const snapshot = await prisma.snapshot.create({
      data: {
        characterId: main.id,
        capturedAt: NOW,
        level: 23,
        xp: 380,
        xpMax: 1000,
        playedTotal: 7200,
        zone: 'Darkshire',
        money: 12345n,
        detail: {},
      },
    });
    await prisma.character.update({ where: { id: main.id }, data: { lastSnapshotId: snapshot.id } });
    await prisma.device.create({
      data: { ownerId: ALICE, tokenSha256: 'a'.repeat(64), gameRunning: true, lastSeenAt: new Date(NOW.getTime() - 60_000) },
    });

    const board = await store.load(GUILD, NOW);

    expect(board).not.toBeNull();
    expect(board?.boardChannelId).toBe('b1');
    expect(board?.boardMessageIds).toEqual(['m1', 'm2']);
    expect(board?.logsChannelId).toBe('l1');
    expect(board?.input.guild).toEqual({ boardSort: 'name' });
    expect(board?.input.now).toEqual(NOW);
    const players = [...(board?.input.players ?? [])].sort((a, b) => a.discordUserId.localeCompare(b.discordUserId));
    expect(players).toEqual([
      {
        discordUserId: ALICE,
        privacy: { hideZone: true, hidePresence: false },
        presence: { online: true, lastSeenAt: new Date(NOW.getTime() - 60_000) },
        main: {
          firstName: 'Davina',
          surname: 'Asaria',
          classFile: 'PRIEST',
          snapshot: { level: 23, xp: 380, xpMax: 1000, playedTotal: 7200, zone: 'Darkshire' },
        },
        alt: { firstName: 'Brom', surname: 'Ferrepied', classFile: null, snapshot: null },
      },
      {
        discordUserId: BOB,
        privacy: { hideZone: false, hidePresence: true },
        presence: { online: false, lastSeenAt: null },
        main: null,
        alt: null,
      },
    ]);
  });

  it('falls back to the level sort for an unknown board_sort', async () => {
    await prisma.guildConfig.update({ where: { guildId: GUILD }, data: { boardSort: 'weird' } });

    await expect(store.load(GUILD, NOW)).resolves.toMatchObject({ input: { guild: { boardSort: 'level' } } });
  });

  it('saves the message ids in order', async () => {
    await store.saveMessageIds(GUILD, ['m9', 'm3']);

    await expect(prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } })).resolves.toMatchObject({
      boardMessageIds: ['m9', 'm3'],
    });
  });

  it('disables the board and keeps the rest of the configuration', async () => {
    await store.disableBoard(GUILD);

    await expect(prisma.guildConfig.findUniqueOrThrow({ where: { guildId: GUILD } })).resolves.toMatchObject({
      boardChannelId: null,
      boardMessageIds: [],
      logsChannelId: 'l1',
      boardSort: 'name',
    });
    await expect(store.listBoardGuildIds()).resolves.toEqual([]);
  });
});
