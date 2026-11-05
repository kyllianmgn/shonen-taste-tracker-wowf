import { OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import {
  BOARD_BOT_ALLOW,
  BOARD_EVERYONE_DENY,
  boardOverwrites,
  missingFlags,
  permissionLabels,
  requiredGuildPermissions,
} from './board-permissions';

const EVERYONE = '200000000000000000';
const BOT = '300000000000000000';

describe('board channel permissions (docs/02 « Admin »)', () => {
  it('denies exactly the five write permissions to @everyone', () => {
    expect([...BOARD_EVERYONE_DENY].sort()).toEqual(
      [
        P.SendMessages,
        P.SendMessagesInThreads,
        P.CreatePublicThreads,
        P.CreatePrivateThreads,
        P.AddReactions,
      ].sort(),
    );
  });

  it('allows exactly view, send, embed links and read history to the bot', () => {
    expect([...BOARD_BOT_ALLOW].sort()).toEqual(
      [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory].sort(),
    );
  });

  it('builds one role overwrite for @everyone and one member overwrite for the bot', () => {
    expect(boardOverwrites(EVERYONE, BOT)).toEqual([
      {
        id: EVERYONE,
        type: OverwriteType.Role,
        allow: 0n,
        deny: P.SendMessages | P.SendMessagesInThreads | P.CreatePublicThreads | P.CreatePrivateThreads | P.AddReactions,
      },
      {
        id: BOT,
        type: OverwriteType.Member,
        allow: P.ViewChannel | P.SendMessages | P.EmbedLinks | P.ReadMessageHistory,
        deny: 0n,
      },
    ]);
  });

  it('requires Manage Channels, plus every flag of the overwrites when the board is created', () => {
    expect(requiredGuildPermissions({ createsBoard: false })).toEqual([P.ManageChannels]);
    const creating = requiredGuildPermissions({ createsBoard: true });
    expect(creating[0]).toBe(P.ManageChannels);
    expect(new Set(creating)).toEqual(new Set([P.ManageChannels, ...BOARD_EVERYONE_DENY, ...BOARD_BOT_ALLOW]));
    expect(creating).toHaveLength(new Set(creating).size);
  });

  it('lists the flags that a bitfield lacks, in the order asked', () => {
    const have = P.ViewChannel | P.EmbedLinks;
    expect(missingFlags(have, BOARD_BOT_ALLOW)).toEqual([P.SendMessages, P.ReadMessageHistory]);
    expect(missingFlags(have | P.SendMessages | P.ReadMessageHistory, BOARD_BOT_ALLOW)).toEqual([]);
  });

  it('labels permissions with the names of the French Discord client', () => {
    expect(permissionLabels([P.ManageChannels, P.SendMessages, P.ReadMessageHistory])).toBe(
      '« Gérer les salons », « Envoyer des messages », « Voir les anciens messages »',
    );
    for (const flag of requiredGuildPermissions({ createsBoard: true })) {
      expect(permissionLabels([flag])).not.toMatch(/inconnue/);
    }
  });
});
