import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { normalizeCharacterName } from './character-name';
import type {
  AddCharacterInput,
  AddCharacterResult,
  CharacterRef,
  CharacterRole,
  OwnedCharacter,
  SetMainResult,
  TrackedRole,
  UntrackResult,
} from './character.types';

type Tx = Prisma.TransactionClient;

interface CharacterRow {
  id: bigint;
  region: string;
  firstName: string;
  surname: string;
  ownerId: string | null;
  role: string | null;
}

const ROLE_ORDER: Record<CharacterRole, number> = { main: 0, alt: 1, untracked: 2 };
/** A write that lost a race on a unique index is replayed from scratch this many times. */
const MAX_ATTEMPTS = 3;

const ref = (c: CharacterRow): CharacterRef => ({ id: c.id, region: c.region, firstName: c.firstName, surname: c.surname });
const roleOf = (c: { role: string | null }): CharacterRole =>
  c.role === 'main' || c.role === 'alt' ? c.role : 'untracked';

/**
 * Character ownership (docs/02 « Modèle de données », « Commandes Discord ») : one owner per
 * character, at most one main and one alt per player, identity region + lower(names).
 * Every operation locks the player row, so a player's own commands never interleave; races between
 * players on a new character end on the unique index and are replayed.
 */
@Injectable()
export class CharacterService {
  constructor(private readonly prisma: PrismaService) {}

  async add(input: AddCharacterInput): Promise<AddCharacterResult> {
    const firstName = normalizeCharacterName(input.firstName);
    const surname = normalizeCharacterName(input.surname);
    if (!firstName || !surname) return { status: 'invalid_name' };
    const name = { region: input.region, firstName, surname };

    return this.withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO player (discord_user_id) VALUES (${input.ownerId}) ON CONFLICT DO NOTHING`;
        await this.lockPlayer(tx, input.ownerId);

        const existing = await this.findByIdentity(tx, name);
        if (existing && existing.ownerId !== null && existing.ownerId !== input.ownerId) {
          return { status: 'owned_by_other', character: ref(existing) };
        }
        if (existing && existing.ownerId === input.ownerId && roleOf(existing) !== 'untracked') {
          await this.addMembership(tx, input.guildId, input.ownerId);
          return { status: 'already_tracked', character: ref(existing), role: roleOf(existing) as TrackedRole };
        }

        const tracked = await this.trackedOf(tx, input.ownerId);
        const holder = (role: TrackedRole) => tracked.find((c) => c.role === role);
        if (tracked.length >= 2) return { status: 'too_many', character: existing ? ref(existing) : name, tracked };
        if (input.role && holder(input.role)) {
          return {
            status: 'role_taken',
            role: input.role,
            character: existing ? ref(existing) : name,
            holder: holder(input.role)!,
          };
        }
        const role: TrackedRole = input.role ?? (holder('main') ? 'alt' : 'main');

        const character = existing
          ? await tx.character.update({ where: { id: existing.id }, data: { ownerId: input.ownerId, role } })
          : await tx.character.create({ data: { ...name, ownerId: input.ownerId, role } });
        await this.addMembership(tx, input.guildId, input.ownerId);
        return { status: 'added', character: ref(character), role, created: !existing };
      }),
    );
  }

  /** The character becomes main; the former main becomes alt (refused if that would track 3). */
  async setMain(ownerId: string, characterId: bigint): Promise<SetMainResult> {
    return this.withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockPlayer(tx, ownerId);
        const target = await tx.character.findFirst({ where: { id: characterId, ownerId } });
        if (!target) return { status: 'not_found' };
        const role = roleOf(target);
        if (role === 'main') return { status: 'already_main', character: ref(target) };

        const tracked = await this.trackedOf(tx, ownerId);
        const main = tracked.find((c) => c.role === 'main');
        const alt = tracked.find((c) => c.role === 'alt');
        if (role === 'untracked' && main && alt) return { status: 'too_many', character: ref(target), tracked };

        // Free the alt slot first: the partial unique indexes are checked after each statement.
        if (role === 'alt') await tx.character.update({ where: { id: target.id }, data: { role: 'untracked' } });
        if (main) await tx.character.update({ where: { id: main.id }, data: { role: 'alt' } });
        await tx.character.update({ where: { id: target.id }, data: { role: 'main' } });
        return { status: 'promoted', character: ref(target), demoted: main ? toRef(main) : null };
      }),
    );
  }

  /** The character stays owned but is no longer tracked (role untracked). */
  async untrack(ownerId: string, characterId: bigint): Promise<UntrackResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPlayer(tx, ownerId);
      const target = await tx.character.findFirst({ where: { id: characterId, ownerId } });
      if (!target) return { status: 'not_found' };
      if (roleOf(target) === 'untracked') return { status: 'already_untracked', character: ref(target) };
      await tx.character.update({ where: { id: target.id }, data: { role: 'untracked' } });
      return { status: 'untracked', character: ref(target) };
    });
  }

  /** Every character of the player: main, alt, then untracked ones by name. */
  list(ownerId: string): Promise<OwnedCharacter[]> {
    return this.ownedBy(this.prisma, ownerId);
  }

  private async ownedBy(db: Tx, ownerId: string, roles?: TrackedRole[]): Promise<OwnedCharacter[]> {
    const rows = await db.character.findMany({
      where: { ownerId, ...(roles ? { role: { in: roles } } : {}) },
      select: { id: true, region: true, firstName: true, surname: true, role: true, bnetVerified: true, lastSnapshotId: true },
    });
    const snapshotIds = rows.map((r) => r.lastSnapshotId).filter((id): id is bigint => id !== null);
    const snapshots = snapshotIds.length
      ? await db.snapshot.findMany({ where: { id: { in: snapshotIds } }, select: { id: true, receivedAt: true } })
      : [];
    const receivedAt = new Map(snapshots.map((s) => [s.id, s.receivedAt]));

    return rows
      .map(
        (r): OwnedCharacter => ({
          id: r.id,
          region: r.region,
          firstName: r.firstName,
          surname: r.surname,
          role: roleOf(r),
          bnetVerified: r.bnetVerified,
          lastSyncAt: (r.lastSnapshotId !== null && receivedAt.get(r.lastSnapshotId)) || null,
        }),
      )
      .sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
          a.firstName.localeCompare(b.firstName, 'fr') ||
          a.surname.localeCompare(b.surname, 'fr'),
      );
  }

  private trackedOf(tx: Tx, ownerId: string): Promise<OwnedCharacter[]> {
    return this.ownedBy(tx, ownerId, ['main', 'alt']);
  }

  private async lockPlayer(tx: Tx, ownerId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM player WHERE discord_user_id = ${ownerId} FOR UPDATE`;
  }

  /** Case-insensitive lookup that matches the character_identity_key index. */
  private async findByIdentity(
    tx: Tx,
    key: { region: string; firstName: string; surname: string },
  ): Promise<CharacterRow | null> {
    const rows = await tx.$queryRaw<CharacterRow[]>`
      SELECT id, region, first_name AS "firstName", surname, owner_id AS "ownerId", role
      FROM "character"
      WHERE region = ${key.region} AND lower(first_name) = lower(${key.firstName}) AND lower(surname) = lower(${key.surname})
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /** The player shows on this guild's board; guild_config gets its defaults if /setup never ran. */
  private async addMembership(tx: Tx, guildId: string, ownerId: string): Promise<void> {
    await tx.$executeRaw`INSERT INTO guild_config (guild_id) VALUES (${guildId}) ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`
      INSERT INTO membership (guild_id, discord_user_id) VALUES (${guildId}, ${ownerId}) ON CONFLICT DO NOTHING`;
  }

  private async withRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isUniqueViolation(error)) throw error;
      }
    }
  }
}

const toRef = (c: OwnedCharacter): CharacterRef => ({
  id: c.id,
  region: c.region,
  firstName: c.firstName,
  surname: c.surname,
});

/** Postgres 23505, whichever way Prisma or the pg adapter reports it. */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') return true;
  let details = '';
  try {
    details = JSON.stringify(error, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    // Unserializable error: fall back to its message.
  }
  return /23505|unique constraint/i.test(`${error.message} ${details}`);
}
