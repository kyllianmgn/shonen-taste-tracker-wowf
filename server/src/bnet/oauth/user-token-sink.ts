import type { Region } from '../../common/config/config';

/**
 * Where the player token goes once /lier battlenet has used it (docs/02 « Flux » step 7).
 * BnetModule provides BaseModeTokenSink: kept encrypted in `bnet_token` in base mode, thrown
 * away in app mode.
 */
export interface UserTokenSink {
  /** Called once per successful link, at the end of the callback. Must never log the token. */
  receive(token: PlayerBnetToken): Promise<void>;
}

export interface PlayerBnetToken {
  ownerId: string;
  region: Region;
  accessToken: string;
  expiresAt: Date;
}

export const BNET_USER_TOKEN_SINK = Symbol('BNET_USER_TOKEN_SINK');
