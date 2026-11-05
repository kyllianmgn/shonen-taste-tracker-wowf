import { Inject, Injectable } from '@nestjs/common';
import {
  BOARD_BOT_ALLOW,
  BOARD_EVERYONE_DENY,
  LOGS_BOT_REQUIRED,
  boardOverwrites,
  missingFlags,
  permissionLabels,
  requiredGuildPermissions,
} from './board-permissions';
import { provisionalBoard } from './provisional-board';
import type { GuildChannelsConfig, GuildConfigStore, SetupGuild, SetupTextChannel } from './setup-ports';

export const BOARD_CHANNEL_NAME = 'tableau-forever';
export const LOGS_CHANNEL_NAME = 'logs-forever';
export const GUILD_CONFIG_STORE = Symbol('GUILD_CONFIG_STORE');

export interface SetupOptions {
  boardChannelId?: string;
  logsChannelId?: string;
}

export interface ResolvedChannel {
  channelId: string;
  created: boolean;
}

export type SetupOutcome =
  | {
      ok: true;
      board: ResolvedChannel;
      logs: ResolvedChannel;
      /** `edited` when the existing board message was reused. */
      boardMessage: 'published' | 'edited';
      /** @everyone denies the spec asks for and the board channel lacks (only for channels we did not create). */
      boardLockGaps: bigint[];
      /** Permissions the bot lacks in the logs channel. */
      logsMissing: bigint[];
    }
  | { ok: false; reason: 'missing_guild_permissions'; missing: bigint[] }
  | { ok: false; reason: 'channel_not_found'; option: 'tableau' | 'logs' }
  | { ok: false; reason: 'same_channel' }
  | { ok: false; reason: 'board_unusable'; channelId: string; missing: bigint[] };

/**
 * /setup (docs/02 « Admin »): find or create the board and logs channels, lock the board, publish the
 * provisional board and save guild_config. Idempotent: a second run reuses the channels (configured
 * ids, then names) and edits the board message in place.
 *
 * Existing channels are checked, never modified: changing a channel's overwrites needs Manage Roles,
 * which the bot does not ask for. Gaps are returned so the admin can fix them by hand.
 */
@Injectable()
export class SetupService {
  constructor(@Inject(GUILD_CONFIG_STORE) private readonly store: GuildConfigStore) {}

  async run(guild: SetupGuild, options: SetupOptions): Promise<SetupOutcome> {
    const guildMissing = missingFlags(guild.botPermissions(), requiredGuildPermissions({ createsBoard: false }));
    if (guildMissing.length > 0) return { ok: false, reason: 'missing_guild_permissions', missing: guildMissing };

    if (options.boardChannelId !== undefined && options.boardChannelId === options.logsChannelId) {
      return { ok: false, reason: 'same_channel' };
    }
    const boardOption = await this.fetchOption(guild, options.boardChannelId);
    if (boardOption === null) return { ok: false, reason: 'channel_not_found', option: 'tableau' };
    const logsOption = await this.fetchOption(guild, options.logsChannelId);
    if (logsOption === null) return { ok: false, reason: 'channel_not_found', option: 'logs' };

    const config = await this.store.find(guild.id);
    const existingBoard = boardOption ?? (await this.findExisting(guild, config?.boardChannelId, BOARD_CHANNEL_NAME));
    const existingLogs = logsOption ?? (await this.findExisting(guild, config?.logsChannelId, LOGS_CHANNEL_NAME));
    if (existingBoard && existingLogs && existingBoard.id === existingLogs.id) {
      return { ok: false, reason: 'same_channel' };
    }

    if (!existingBoard) {
      const missing = missingFlags(guild.botPermissions(), requiredGuildPermissions({ createsBoard: true }));
      if (missing.length > 0) return { ok: false, reason: 'missing_guild_permissions', missing };
    } else {
      const missing = missingFlags(existingBoard.botPermissions(), BOARD_BOT_ALLOW);
      if (missing.length > 0) return { ok: false, reason: 'board_unusable', channelId: existingBoard.id, missing };
    }

    const board =
      existingBoard ??
      (await guild.createTextChannel(BOARD_CHANNEL_NAME, boardOverwrites(guild.everyoneRoleId, guild.botUserId)));
    const logs = existingLogs ?? (await guild.createTextChannel(LOGS_CHANNEL_NAME, []));

    const { boardMessageIds, boardMessage } = await this.publishBoard(guild, board, config);
    const saved: GuildChannelsConfig = { boardChannelId: board.id, logsChannelId: logs.id, boardMessageIds };
    await this.store.saveChannels(guild.id, saved);

    return {
      ok: true,
      board: { channelId: board.id, created: !existingBoard },
      logs: { channelId: logs.id, created: !existingLogs },
      boardMessage,
      boardLockGaps: existingBoard ? missingFlags(board.everyoneDeny(), BOARD_EVERYONE_DENY) : [],
      logsMissing: missingFlags(logs.botPermissions(), LOGS_BOT_REQUIRED),
    };
  }

  /** undefined = option not given; null = given but unusable. */
  private async fetchOption(guild: SetupGuild, channelId: string | undefined) {
    if (channelId === undefined) return undefined;
    return guild.fetchTextChannel(channelId);
  }

  private async findExisting(
    guild: SetupGuild,
    configuredId: string | null | undefined,
    name: string,
  ): Promise<SetupTextChannel | null> {
    if (configuredId) {
      const configured = await guild.fetchTextChannel(configuredId);
      if (configured) return configured;
    }
    return guild.findTextChannelByName(name);
  }

  private async publishBoard(
    guild: SetupGuild,
    board: SetupTextChannel,
    config: GuildChannelsConfig | null,
  ): Promise<{ boardMessageIds: string[]; boardMessage: 'published' | 'edited' }> {
    const payload = provisionalBoard();
    const previousIds = config?.boardMessageIds ?? [];

    if (config?.boardChannelId === board.id && previousIds.length > 0) {
      if (await board.editMessage(previousIds[0], payload)) {
        return { boardMessageIds: previousIds, boardMessage: 'edited' };
      }
      for (const id of previousIds.slice(1)) await board.deleteMessage(id);
    } else if (config?.boardChannelId && previousIds.length > 0) {
      // The board moved: remove the old messages so two boards do not coexist.
      const oldChannel = await guild.fetchTextChannel(config.boardChannelId);
      if (oldChannel) for (const id of previousIds) await oldChannel.deleteMessage(id);
    }

    return { boardMessageIds: [await board.send(payload)], boardMessage: 'published' };
  }
}

/** Ephemeral answer to /setup, in French. */
export function formatSetupReply(outcome: SetupOutcome): string {
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'missing_guild_permissions':
        return `❌ Il me manque sur le serveur : ${permissionLabels(outcome.missing)}. Ajoute ces permissions à mon rôle puis relance \`/setup\`.`;
      case 'channel_not_found':
        return `❌ Je ne trouve pas le salon choisi pour ${outcome.option === 'tableau' ? 'le tableau' : 'les logs'}, ou je ne peux pas le voir.`;
      case 'same_channel':
        return '❌ Le tableau et les logs doivent être deux salons différents.';
      case 'board_unusable':
        return `❌ Je ne peux pas publier le tableau dans <#${outcome.channelId}> : il me manque ${permissionLabels(outcome.missing)}.`;
    }
  }

  const state = (c: ResolvedChannel) => (c.created ? 'créé' : 'existant');
  const lines = [
    '✅ Configuration enregistrée.',
    `• Tableau : <#${outcome.board.channelId}> (${state(outcome.board)})`,
    `• Logs : <#${outcome.logs.channelId}> (${state(outcome.logs)})`,
    outcome.boardMessage === 'edited' ? 'Le tableau est mis à jour.' : 'Le tableau est publié.',
  ];
  if (outcome.boardLockGaps.length > 0) {
    lines.push(
      `⚠️ <#${outcome.board.channelId}> n’est pas verrouillé : dans les permissions du salon, refuse à @everyone ${permissionLabels(outcome.boardLockGaps)}.`,
    );
  }
  if (outcome.logsMissing.length > 0) {
    lines.push(
      `⚠️ Je ne peux pas écrire dans <#${outcome.logs.channelId}> : il me manque ${permissionLabels(outcome.logsMissing)}.`,
    );
  }
  return lines.join('\n');
}
