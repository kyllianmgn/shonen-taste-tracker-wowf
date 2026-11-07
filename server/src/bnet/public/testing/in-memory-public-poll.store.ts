import type { Region } from '../../../common/config/config';
import type { CharacterRole } from '../../../core/characters/character.types';
import { deduceLevelUps } from '../../polling/level-ups';
import type { AppliedPublicReading, ProbeCandidate, PublicPollStore, PublicPollTarget } from '../public-poll.store';
import { planPublicReading, type PublicPollState, type PublicReading } from '../public-reading';

export interface MemoryCharacter {
  characterId: bigint;
  ownerId: string;
  role: CharacterRole;
  region: Region;
  firstName: string;
  surname: string;
  verified?: boolean;
  snapshots: Array<{ id: bigint; level: number; capturedAt: Date; source: string; equipment?: unknown }>;
  poll: (PublicPollState & { nextPollAt: Date }) | null;
}

/** Test double of PrismaPublicPollStore: same plan, state kept in memory. */
export class InMemoryPublicPollStore implements PublicPollStore {
  readonly characters: MemoryCharacter[] = [];
  readonly rescheduled: Array<{ characterId: bigint; nextPollAt: Date }> = [];
  readonly sessions: AppliedPublicReading['session'][] = [];
  private nextId = 1000n;

  add(character: Omit<MemoryCharacter, 'snapshots' | 'poll'> & Partial<MemoryCharacter>): MemoryCharacter {
    const full: MemoryCharacter = { snapshots: [], poll: null, ...character };
    this.characters.push(full);
    return full;
  }

  dueTargets(now: Date): Promise<PublicPollTarget[]> {
    return Promise.resolve(
      this.characters
        .filter((c) => c.poll === null || c.poll.nextPollAt <= now)
        .map((c) => ({
          characterId: c.characterId,
          ownerId: c.ownerId,
          region: c.region,
          firstName: c.firstName,
          surname: c.surname,
          poll: c.poll && { lastModified: c.poll.lastModified, lastLoginAt: c.poll.lastLoginAt, changedAt: c.poll.changedAt },
        })),
    );
  }

  reschedule(characterId: bigint, nextPollAt: Date): Promise<void> {
    this.rescheduled.push({ characterId, nextPollAt });
    const c = this.find(characterId);
    c.poll = { ...(c.poll ?? { lastModified: null, lastLoginAt: null, changedAt: null }), nextPollAt };
    return Promise.resolve();
  }

  applyReading(target: PublicPollTarget, reading: PublicReading, now: Date): Promise<AppliedPublicReading | null> {
    const c = this.find(target.characterId);
    const last = c.snapshots.at(-1) ?? null;
    const lastPublic = c.snapshots.filter((s) => s.source === 'bnet_public').at(-1);
    const plan = planPublicReading({
      previous: last && { level: last.level, capturedAt: last.capturedAt },
      lastPublicEquipment: lastPublic ? lastPublic.equipment : undefined,
      poll: c.poll,
      reading,
      now,
    });
    c.poll = plan.poll;

    let snapshot: AppliedPublicReading['snapshot'] = null;
    if (plan.snapshot) {
      snapshot = { id: this.nextId++, level: plan.snapshot.level };
      c.snapshots.push({ ...snapshot, capturedAt: now, source: 'bnet_public', equipment: plan.snapshot.equipment });
    }
    const flags = plan.snapshot?.flags ?? [];
    const events = plan.levelUps
      ? deduceLevelUps(c.characterId, plan.levelUps.from, plan.levelUps.to, now).map((e) => ({ ...e, id: this.nextId++ }))
      : [];
    const session = plan.sessionEnd ? { id: this.nextId++, ...plan.sessionEnd } : null;
    if (session) this.sessions.push(session);
    return Promise.resolve({ characterId: c.characterId, ownerId: c.ownerId, role: c.role, snapshot, flags, events, session });
  }

  probeCandidate(): Promise<ProbeCandidate | null> {
    const found = this.characters.find((c) => c.verified && (c.snapshots.at(-1)?.level ?? 0) >= 10);
    return Promise.resolve(found ? { region: found.region, firstName: found.firstName, surname: found.surname } : null);
  }

  private find(characterId: bigint): MemoryCharacter {
    const c = this.characters.find((x) => x.characterId === characterId);
    if (!c) throw new Error(`unknown character ${characterId}`);
    return c;
  }
}
