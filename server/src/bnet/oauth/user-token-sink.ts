import { Injectable } from '@nestjs/common';
import type { Region } from '../../common/config/config';

/**
 * Where the player token goes once /lier battlenet has used it (docs/02 « Flux » step 7).
 *
 * Extension point for S-18 (base mode): provide another implementation under BNET_USER_TOKEN_SINK
 * that, for a player without an active device, stores the token AES-256-GCM encrypted in
 * `bnet_token` until `expiresAt` (24 h at most). App mode keeps the default below.
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

/** App mode (S-17): the token is thrown away; nothing is stored. */
@Injectable()
export class DiscardUserTokenSink implements UserTokenSink {
  receive(): Promise<void> {
    return Promise.resolve();
  }
}
