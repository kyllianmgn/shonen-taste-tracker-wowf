/** Regions accepted by the contract and /perso ajouter (docs/03 « Régions acceptées »). */
export const REGIONS = ['eu', 'us', 'kr', 'tw'] as const;
export type Region = (typeof REGIONS)[number];

/** Roles of a tracked character; at most one of each per player (partial unique indexes). */
export type TrackedRole = 'main' | 'alt';
export type CharacterRole = TrackedRole | 'untracked';

/** Region + first name + surname: the identity of a Forever character (docs/00). */
export interface CharacterName {
  region: string;
  firstName: string;
  surname: string;
}

export interface CharacterRef extends CharacterName {
  id: bigint;
}

/** A character of the player, as /perso liste and the autocomplete show it. */
export interface OwnedCharacter extends CharacterRef {
  role: CharacterRole;
  bnetVerified: boolean;
  /** Reception time of the last snapshot, null when never synced. */
  lastSyncAt: Date | null;
}

export interface AddCharacterInput {
  ownerId: string;
  /** Guild where the command was used: the player gets a membership row there. */
  guildId: string;
  region: Region;
  /** Raw names as typed; the service normalizes them. */
  firstName: string;
  surname: string;
  /** Without a role, the first free one is given: main, then alt. */
  role?: TrackedRole;
}

export type AddCharacterResult =
  | { status: 'added'; character: CharacterRef; role: TrackedRole; created: boolean }
  | { status: 'already_tracked'; character: CharacterRef; role: TrackedRole }
  | { status: 'owned_by_other'; character: CharacterRef }
  | { status: 'role_taken'; role: TrackedRole; character: CharacterName; holder: CharacterRef }
  | { status: 'too_many'; character: CharacterName; tracked: OwnedCharacter[] }
  | { status: 'invalid_name' };

export type SetMainResult =
  | { status: 'promoted'; character: CharacterRef; demoted: CharacterRef | null }
  | { status: 'already_main'; character: CharacterRef }
  | { status: 'too_many'; character: CharacterRef; tracked: OwnedCharacter[] }
  | { status: 'not_found' };

export type UntrackResult =
  | { status: 'untracked'; character: CharacterRef }
  | { status: 'already_untracked'; character: CharacterRef }
  | { status: 'not_found' };

export type SetAltResult =
  | { status: 'set'; character: CharacterRef; replaced: CharacterRef | null }
  | { status: 'already_alt'; character: CharacterRef }
  | { status: 'is_main'; character: CharacterRef }
  | { status: 'not_found' };

/** One character of a Battle.net account, as /lier battlenet imports it (docs/02 « Flux » step 4). */
export interface BnetCharacterData {
  firstName: string;
  surname: string;
  classFile: string | null;
  raceFile: string | null;
  faction: 'Alliance' | 'Horde' | 'Neutral' | null;
  realmName: string | null;
  ruleset: string | null;
}

export interface LinkFromBnetInput {
  ownerId: string;
  region: Region;
  characters: BnetCharacterData[];
}

/** See LinkEntryOutcome in bnet/oauth/link-outcome.ts for the meaning of each outcome. */
export interface BnetLinkEntry {
  character: CharacterRef;
  outcome: 'verified' | 'claimed' | 'created' | 'transferred' | 'owned_by_other';
  /** Role for the member after the link; null when the character stays another member's. */
  role: CharacterRole | null;
  /** Set for `transferred`: the member who lost the character. */
  previousOwnerId?: string;
}
