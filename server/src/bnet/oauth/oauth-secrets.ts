import { randomBytes } from 'node:crypto';

/**
 * OAuth state and authorize link of /lier battlenet (docs/02 « Flux » step 1). Only the SHA-256 of
 * the state is stored (CLAUDE.md hard rules); the plain value lives in the link only.
 */

export const BNET_AUTHORIZE_URL = 'https://oauth.battle.net/authorize';
export const BNET_SCOPE = 'wow.profile';
const STATE_BYTES = 32;

export function generateOauthState(): string {
  return randomBytes(STATE_BYTES).toString('base64url');
}

export function buildAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(BNET_AUTHORIZE_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', BNET_SCOPE);
  url.searchParams.set('state', opts.state);
  return url.toString();
}
