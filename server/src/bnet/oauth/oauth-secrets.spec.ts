import { buildAuthorizeUrl, generateOauthState } from './oauth-secrets';

describe('generateOauthState', () => {
  it('is 32 random bytes in base64url', () => {
    const state = generateOauthState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(state, 'base64url')).toHaveLength(32);
    expect(generateOauthState()).not.toBe(state);
  });
});

describe('buildAuthorizeUrl', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'my-client',
      redirectUri: 'https://ft.example.org/oauth/bnet/callback',
      state: 'abc_DEF-123',
    }),
  );

  it('points to the Battle.net authorize endpoint', () => {
    expect(`${url.origin}${url.pathname}`).toBe('https://oauth.battle.net/authorize');
  });

  it('asks for a code with the wow.profile scope, the redirect URI and the state', () => {
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'my-client',
      redirect_uri: 'https://ft.example.org/oauth/bnet/callback',
      response_type: 'code',
      scope: 'wow.profile',
      state: 'abc_DEF-123',
    });
  });

  it('fits in a Discord link button (512 characters)', () => {
    expect(url.toString().length).toBeLessThanOrEqual(512);
  });
});
