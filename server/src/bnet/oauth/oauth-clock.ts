/** Time source of the OAuth flow (state expiry), replaceable in tests. */
export interface OauthClock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const BNET_OAUTH_CLOCK = Symbol('BNET_OAUTH_CLOCK');

export const systemOauthClock: OauthClock = { now: () => Date.now() };
