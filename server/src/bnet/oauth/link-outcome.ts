import type { Region } from '../../common/config/config';
import type { CharacterRef, CharacterRole } from '../../core/characters/character.types';

/** Result of a /lier battlenet callback, as Discord shows it (docs/02 « Liaison Battle.net »). */

/** docs/02 « Erreurs », account profile in 404. Shared by the callback page and the Discord reply. */
export const NO_FOREVER_CHARACTER_HELP =
  'Aucun perso Forever trouvé. Connecte-toi une fois en jeu puis déconnecte-toi, et vérifie que le partage des données de jeu avec les développeurs est activé dans la confidentialité Battle.net.';

/**
 * What step 5 did to one character of the account:
 * - verified: already the member's, now bnet_verified;
 * - claimed: known without owner, attached to the member (untracked);
 * - created: unknown, created for the member (untracked);
 * - transferred: owned by another member without verification, moved to this member (untracked), admins told;
 * - owned_by_other: owned by another member who verified it; left alone.
 */
export type LinkEntryOutcome = 'verified' | 'claimed' | 'created' | 'transferred' | 'owned_by_other';

export interface LinkedCharacter extends CharacterRef {
  level: number | null;
  /** Role for the member after the link; null when the character is not theirs (owned_by_other). */
  role: CharacterRole | null;
  outcome: LinkEntryOutcome;
}

export type LinkOutcome =
  | { status: 'linked'; region: Region; characters: LinkedCharacter[] }
  /** Account profile in 404: no Forever character yet. */
  | { status: 'no_characters' }
  /** The member refused the authorization on Battle.net. */
  | { status: 'denied' }
  /** Code refused, 401/403 twice, Battle.net down… : generic message, details in the server log. */
  | { status: 'failed' };

export interface TransferNotice {
  character: CharacterRef;
  fromUserId: string;
  toUserId: string;
}
