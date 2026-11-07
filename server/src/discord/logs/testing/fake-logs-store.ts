import type { LogPrivacy } from '../../render/logs';
import type { ClaimedEvent, LogCharacterInfo, LogTarget, LogsStore } from '../logs-ports';

interface FakeEvent {
  characterId: bigint;
  type: string;
  level: number | null;
  publishedAt: Date | null;
}

const VISIBLE: LogPrivacy = { hideMoney: false, hideZone: false, hidePresence: false };

/**
 * In-memory guild_config, membership, player privacy, characters and game_event.published_at.
 * It outlives a publisher, like the database outlives a restart.
 */
export class FakeLogsStore implements LogsStore {
  readonly guilds = new Map<string, LogTarget>();
  readonly memberships = new Map<string, string[]>();
  readonly privacy = new Map<string, LogPrivacy>();
  readonly characters = new Map<bigint, LogCharacterInfo>();
  readonly events = new Map<bigint, FakeEvent>();

  addGuild(guildId: string, settings: Partial<Omit<LogTarget, 'guildId'>> = {}): LogTarget {
    const target: LogTarget = { guildId, logsChannelId: `logs-${guildId}`, levelAnnounceStep: 1, logDeaths: false, ...settings };
    this.guilds.set(guildId, target);
    return target;
  }

  addPlayer(discordUserId: string, guildIds: string[], privacy: Partial<LogPrivacy> = {}): void {
    this.memberships.set(discordUserId, guildIds);
    this.privacy.set(discordUserId, { ...VISIBLE, ...privacy });
  }

  addCharacter(id: bigint, info: Partial<LogCharacterInfo> = {}): void {
    this.characters.set(id, { firstName: 'Davina', surname: 'Asaria', role: 'main', level: 23, female: true, ...info });
  }

  publishedAt(id: bigint): Date | null {
    return this.events.get(id)?.publishedAt ?? null;
  }

  targetsOfPlayer(discordUserId: string): Promise<LogTarget[]> {
    const guildIds = this.memberships.get(discordUserId) ?? [];
    return Promise.resolve(guildIds.map((id) => this.guilds.get(id)).filter((t): t is LogTarget => t !== undefined));
  }

  privacyOf(discordUserId: string): Promise<LogPrivacy> {
    return Promise.resolve(this.privacy.get(discordUserId) ?? VISIBLE);
  }

  characterOf(characterId: bigint): Promise<LogCharacterInfo | null> {
    return Promise.resolve(this.characters.get(characterId) ?? null);
  }

  claimEvent(event: ClaimedEvent, now: Date): Promise<boolean> {
    let row = this.events.get(event.id);
    if (!row) {
      row = { characterId: event.characterId, type: event.type, level: event.level, publishedAt: null };
      this.events.set(event.id, row);
    }
    if (row.publishedAt) return Promise.resolve(false);
    if (event.type === 'LEVEL_UP' && event.level !== null) {
      for (const [id, other] of this.events) {
        const sameLevel = other.characterId === event.characterId && other.type === 'LEVEL_UP' && other.level === event.level;
        if (id !== event.id && sameLevel && other.publishedAt) return Promise.resolve(false);
      }
    }
    row.publishedAt = now;
    return Promise.resolve(true);
  }
}
