import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { LeaderboardEntry, Privacy, ProfileDetail, ProfileInput, SessionInput } from '../render/profile';

/** Level-ups shown by /profil. */
const PROFILE_LEVELS = 10;
/** Ended sessions looked at to find the last non-trivial one. */
const SESSION_LOOKBACK = 20;
/** A session shorter than this without any change gets no recap (docs/02 « Récap de session »). */
const TRIVIAL_SESSION_MS = 2 * 60 * 1000;

const PRIVACY_SELECT = { hideMoney: true, hideZone: true, hidePresence: true } as const;

/**
 * Reads what /profil, /session and /classement show and maps it into the render inputs of
 * render/profile.ts. Flagged events (suspect, late) are never counted.
 */
@Injectable()
export class ProfileQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** True when the player has a membership on this guild (shown on its board). */
  async isMember(guildId: string, discordUserId: string): Promise<boolean> {
    const row = await this.prisma.membership.findUnique({
      where: { guildId_discordUserId: { guildId, discordUserId } },
      select: { guildId: true },
    });
    return row !== null;
  }

  /** Profile of a tracked character of the player; null if it is not theirs or untracked. */
  async profile(ownerId: string, characterId: bigint): Promise<ProfileInput | null> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, ownerId, role: { in: ['main', 'alt'] } },
      select: {
        firstName: true,
        surname: true,
        classFile: true,
        role: true,
        lastSnapshotId: true,
        owner: { select: PRIVACY_SELECT },
      },
    });
    if (!character?.owner) return null;

    const snapshot = character.lastSnapshotId
      ? await this.prisma.snapshot.findUnique({ where: { id: character.lastSnapshotId } })
      : null;
    const levelUps = await this.prisma.gameEvent.findMany({
      where: { characterId, type: 'LEVEL_UP', flags: { isEmpty: true } },
      orderBy: { at: 'desc' },
      take: PROFILE_LEVELS,
      select: { at: true, data: true },
    });

    return {
      discordUserId: ownerId,
      privacy: character.owner,
      character: {
        firstName: character.firstName,
        surname: character.surname,
        classFile: character.classFile,
        role: character.role === 'alt' ? 'alt' : 'main',
      },
      snapshot: snapshot && {
        level: snapshot.level,
        xp: snapshot.xp,
        xpMax: snapshot.xpMax,
        money: snapshot.money,
        playedTotal: snapshot.playedTotal,
        zone: snapshot.zone,
        subZone: snapshot.subZone,
        receivedAt: snapshot.receivedAt,
        detail: parseDetail(snapshot.detail),
      },
      levels: levelUps.flatMap((e) => {
        const level = record(e.data).level;
        return isInt(level) ? [{ level, at: e.at }] : [];
      }),
    };
  }

  /**
   * The session in progress (never with hide_presence), else the last ended session that would
   * get a recap. Null when there is none.
   */
  async session(ownerId: string, now: Date): Promise<SessionInput | null> {
    const player = await this.prisma.player.findUnique({ where: { discordUserId: ownerId }, select: PRIVACY_SELECT });
    if (!player) return null;

    const select = {
      characterId: true,
      startedAt: true,
      endedAt: true,
      levelStart: true,
      levelEnd: true,
      moneyStart: true,
      moneyEnd: true,
      playedStart: true,
      playedEnd: true,
      character: { select: { firstName: true, surname: true } },
    } as const;
    const live = player.hidePresence
      ? null
      : await this.prisma.gameSession.findFirst({ where: { ownerId, endedAt: null }, orderBy: { startedAt: 'desc' }, select });
    const chosen =
      live ??
      (
        await this.prisma.gameSession.findMany({
          where: { ownerId, endedAt: { not: null } },
          orderBy: { endedAt: 'desc' },
          take: SESSION_LOOKBACK,
          select,
        })
      ).find((s) => !isTrivial(s));
    if (!chosen) return null;

    const end = chosen.endedAt ?? now;
    let deaths = 0;
    let lastPlace: { zone: string | null; subZone: string | null } | null = null;
    if (chosen.characterId !== null) {
      const period = { gte: chosen.startedAt, lte: end };
      deaths = await this.prisma.gameEvent.count({
        where: { characterId: chosen.characterId, type: 'DEATH', flags: { isEmpty: true }, at: period },
      });
      lastPlace = await this.prisma.snapshot.findFirst({
        where: { characterId: chosen.characterId, capturedAt: period },
        orderBy: { capturedAt: 'desc' },
        select: { zone: true, subZone: true },
      });
    }

    return {
      discordUserId: ownerId,
      privacy: player,
      character: chosen.character,
      startedAt: chosen.startedAt,
      endedAt: chosen.endedAt,
      levelStart: chosen.levelStart,
      levelEnd: chosen.levelEnd,
      moneyStart: chosen.moneyStart,
      moneyEnd: chosen.moneyEnd,
      playedStart: chosen.playedStart,
      playedEnd: chosen.playedEnd,
      zone: lastPlace?.zone ?? null,
      subZone: lastPlace?.subZone ?? null,
      deaths,
    };
  }

  /** One entry per member of the guild that has a main character, with its last snapshot. */
  async leaderboard(guildId: string): Promise<LeaderboardEntry[]> {
    const members = await this.prisma.membership.findMany({
      where: { guildId },
      select: {
        player: {
          select: {
            discordUserId: true,
            ...PRIVACY_SELECT,
            characters: { where: { role: 'main' }, select: { firstName: true, surname: true, lastSnapshotId: true } },
          },
        },
      },
    });
    const snapshotIds = members
      .map((m) => m.player.characters[0]?.lastSnapshotId)
      .filter((id): id is bigint => id !== null && id !== undefined);
    const snapshots = snapshotIds.length
      ? await this.prisma.snapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: { id: true, level: true, xp: true, xpMax: true, playedTotal: true, money: true, detail: true },
        })
      : [];
    const byId = new Map(snapshots.map((s) => [s.id, s]));

    return members.flatMap(({ player }) => {
      const main = player.characters[0];
      if (!main) return [];
      const s = main.lastSnapshotId !== null ? byId.get(main.lastSnapshotId) : undefined;
      const deaths = s ? record(s.detail).deaths : undefined;
      const privacy: Privacy = { hideMoney: player.hideMoney, hideZone: player.hideZone, hidePresence: player.hidePresence };
      return [
        {
          discordUserId: player.discordUserId,
          privacy,
          character: { firstName: main.firstName, surname: main.surname },
          snapshot: s
            ? {
                level: s.level,
                xp: s.xp,
                xpMax: s.xpMax,
                playedTotal: s.playedTotal,
                money: s.money,
                deaths: isInt(deaths) ? deaths : null,
              }
            : null,
        },
      ];
    });
  }
}

interface SessionValues {
  startedAt: Date;
  endedAt: Date | null;
  levelStart: number | null;
  levelEnd: number | null;
  moneyStart: bigint | null;
  moneyEnd: bigint | null;
  playedStart: number | null;
  playedEnd: number | null;
}

/** Under 2 min without any change: closed without a recap (docs/02 « Récap de session »). */
function isTrivial(s: SessionValues): boolean {
  if (!s.endedAt) return false;
  const short = s.endedAt.getTime() - s.startedAt.getTime() < TRIVIAL_SESSION_MS;
  // Played time always grows while in game, so it is no sign of a change.
  return short && s.levelStart === s.levelEnd && s.moneyStart === s.moneyEnd;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

const optionalString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `snapshot.detail` as /profil reads it; malformed items are dropped. */
export function parseDetail(detail: unknown): ProfileDetail {
  const d = record(detail);
  return {
    guild: optionalString(d.guild),
    guildRank: optionalString(d.guildRank),
    ilvl: typeof d.ilvl === 'number' && Number.isFinite(d.ilvl) ? d.ilvl : null,
    professions: asArray(d.professions).flatMap((item) => {
      const p = record(item);
      const name = optionalString(p.name);
      return name && isInt(p.rank) ? [{ name, rank: p.rank, max: isInt(p.max) ? p.max : null }] : [];
    }),
    reputations: asArray(d.reputations).flatMap((item) => {
      const r = record(item);
      const name = optionalString(r.name);
      return name && isInt(r.standing) ? [{ name, standing: r.standing }] : [];
    }),
  };
}
