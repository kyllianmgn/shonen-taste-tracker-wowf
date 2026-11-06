/**
 * Shapes of the Forever API responses. Only fields cited in docs/02 « Liaison Battle.net »
 * and contract/fixtures/bnet are typed: the API is not documented by Blizzard.
 */

export interface BnetRef {
  href: string;
}

export interface BnetNamedId {
  name: string;
  id: number;
}

export interface BnetNamedType {
  type: string;
  name: string;
}

export interface BnetAccountCharacter {
  character: BnetRef;
  /** `…/protected-character/{realmId}-{characterId}`: the only place the realm appears. */
  protected_character: BnetRef;
  name: string;
  surname: string;
  id: number;
  playable_class: BnetNamedId;
  playable_race: BnetNamedId;
  gender: BnetNamedType;
  faction: BnetNamedType;
  level: number;
}

export interface BnetAccountProfile {
  wow_accounts: Array<{ id: number; characters: BnetAccountCharacter[] }>;
}

export interface BnetRealm {
  id: number;
  name: string;
  slug: string;
  /** `type.type` of the realm, e.g. `NORMAL`. */
  ruleset: string;
}

/** Public character profile (not open yet): level, equipment, `last_login_timestamp`. */
export interface BnetPublicCharacter {
  level?: number;
  last_login_timestamp?: number;
  [field: string]: unknown;
}

export type BnetPublicCharacterResult =
  | { status: 200; character: BnetPublicCharacter; lastModified?: string }
  | { status: 304 }
  | { status: 404 };

/** Player token from the authorization code grant: valid `expiresInSec` (24 h), no refresh token. */
export interface BnetUserToken {
  accessToken: string;
  expiresInSec: number;
}
