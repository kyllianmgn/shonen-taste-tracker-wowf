import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nock from 'nock';
import { BnetClient } from './bnet-client';
import {
  BnetAuthError,
  BnetHttpError,
  BnetNotFoundError,
  BnetRateLimitedError,
  BnetUnauthorizedError,
} from './bnet-errors';
import { FakeClock } from './testing/fake-clock';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'contract', 'fixtures', 'bnet');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

const OAUTH = 'https://oauth.battle.net';
const EU = 'https://eu.api.blizzard.com';
const BASIC = `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`;
const DAY_MS = 86_400_000;

function appToken(accessToken = 'app-token-1', expiresIn = 86_400) {
  return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn };
}

function mockAppToken(accessToken = 'app-token-1', expiresIn = 86_400): nock.Scope {
  return nock(OAUTH, { reqheaders: { authorization: BASIC } })
    .post('/token', 'grant_type=client_credentials')
    .reply(200, appToken(accessToken, expiresIn));
}

describe('BnetClient', () => {
  let clock: FakeClock;
  let client: BnetClient;

  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());

  beforeEach(() => {
    nock.cleanAll();
    clock = new FakeClock(Date.UTC(2026, 10, 5));
    client = new BnetClient({ clientId: 'client-id', clientSecret: 'client-secret' }, clock);
  });

  afterEach(() => {
    const pending = nock.pendingMocks();
    nock.cleanAll();
    expect(pending).toEqual([]);
  });

  describe('getAccountProfile', () => {
    it('reads the account profile with the user token, in the regional profile namespace', async () => {
      nock(EU, { reqheaders: { authorization: 'Bearer test-user-token' } })
        .get('/profile/user/wow')
        .query({ namespace: 'profile-forever-eu', locale: 'fr_FR' })
        .reply(200, fixture('account-profile.json'));

      const profile = await client.getAccountProfile('eu', 'test-user-token');

      const character = profile.wow_accounts[0].characters[0];
      expect(character).toMatchObject({
        name: 'Davina',
        surname: 'Asaria',
        id: 716333,
        level: 23,
        playable_class: { id: 5 },
        playable_race: { id: 8 },
        faction: { type: 'HORDE' },
      });
      expect(character.protected_character.href).toContain('/protected-character/6855-716333');
    });

    it('uses the host and namespace of the requested region', async () => {
      nock('https://us.api.blizzard.com')
        .get('/profile/user/wow')
        .query({ namespace: 'profile-forever-us', locale: 'fr_FR' })
        .reply(200, { wow_accounts: [] });

      await expect(client.getAccountProfile('us', 'test-user-token')).resolves.toEqual({ wow_accounts: [] });
    });

    it('throws BnetNotFoundError when the account has no Forever character (404)', async () => {
      nock(EU)
        .get('/profile/user/wow')
        .query(true)
        .reply(404, fixture('account-profile.404.json'));

      await expect(client.getAccountProfile('eu', 'test-user-token')).rejects.toBeInstanceOf(BnetNotFoundError);
    });

    it.each([401, 403])('throws BnetUnauthorizedError on %i, without retrying', async (status) => {
      nock(EU).get('/profile/user/wow').query(true).reply(status);

      await expect(client.getAccountProfile('eu', 'test-user-token')).rejects.toBeInstanceOf(BnetUnauthorizedError);
    });

    it('throws BnetHttpError on other failures', async () => {
      nock(EU).get('/profile/user/wow').query(true).reply(500);

      const error = await client.getAccountProfile('eu', 'test-user-token').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BnetHttpError);
      expect((error as BnetHttpError).status).toBe(500);
    });

    it('never puts the token in error messages', async () => {
      nock(EU).get('/profile/user/wow').query(true).reply(401);

      const error = (await client.getAccountProfile('eu', 'test-user-token').catch((e: unknown) => e)) as Error;

      expect(error.message).not.toContain('test-user-token');
    });
  });

  describe('getRealm', () => {
    it('returns the ruleset of realm 6855 (NORMAL) using the app token', async () => {
      mockAppToken();
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-1' } })
        .get('/data/wow/realm/6855')
        .query({ namespace: 'dynamic-forever-eu' })
        .reply(200, fixture('realm-6855.json'));

      const realm = await client.getRealm('eu', 6855);

      expect(realm).toEqual({ id: 6855, name: 'CAMWOW EU5 Realm 1 PvE', slug: 'camwow-eu5-realm-1-pve', ruleset: 'NORMAL' });
    });

    it('caches realms for 24 h', async () => {
      mockAppToken();
      const realm = nock(EU).get('/data/wow/realm/6855').query(true).times(2).reply(200, fixture('realm-6855.json'));

      await client.getRealm('eu', 6855);
      clock.advance(DAY_MS - 1);
      await client.getRealm('eu', 6855);
      expect(realm.isDone()).toBe(false);

      clock.advance(1);
      mockAppToken('app-token-2'); // the 24 h app token is due for renewal too
      await client.getRealm('eu', 6855);
      expect(realm.isDone()).toBe(true);
    });

    it('keeps one cache per region', async () => {
      mockAppToken();
      nock(EU).get('/data/wow/realm/6855').query({ namespace: 'dynamic-forever-eu' }).reply(200, fixture('realm-6855.json'));
      nock('https://kr.api.blizzard.com')
        .get('/data/wow/realm/6855')
        .query({ namespace: 'dynamic-forever-kr' })
        .reply(200, fixture('realm-6855.json'));

      await client.getRealm('eu', 6855);
      await client.getRealm('kr', 6855);
    });

    it('throws BnetNotFoundError for an unknown realm', async () => {
      mockAppToken();
      nock(EU).get('/data/wow/realm/1').query(true).reply(404);

      await expect(client.getRealm('eu', 1)).rejects.toBeInstanceOf(BnetNotFoundError);
    });

    it('throws BnetHttpError when the realm has no ruleset', async () => {
      mockAppToken();
      nock(EU).get('/data/wow/realm/6855').query(true).reply(200, { id: 6855, name: 'x', slug: 'x' });

      await expect(client.getRealm('eu', 6855)).rejects.toBeInstanceOf(BnetHttpError);
    });
  });

  describe('app token', () => {
    it('is fetched once and reused while valid', async () => {
      mockAppToken();
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-1' } })
        .get(/\/data\/wow\/realm\/\d+/)
        .query(true)
        .times(2)
        .reply(200, fixture('realm-6855.json'));

      await Promise.all([client.getRealm('eu', 1), client.getRealm('eu', 2)]);
    });

    it('is renewed before it expires', async () => {
      mockAppToken('app-token-1', 3600);
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-1' } })
        .get('/data/wow/realm/1')
        .query(true)
        .reply(200, fixture('realm-6855.json'));
      await client.getRealm('eu', 1);

      // 5 minutes before expiry the cached token is no longer used.
      clock.advance(3600_000 - 5 * 60_000);
      mockAppToken('app-token-2', 3600);
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-2' } })
        .get('/data/wow/realm/2')
        .query(true)
        .reply(200, fixture('realm-6855.json'));
      await client.getRealm('eu', 2);
    });

    it('is renewed once when the API rejects it (401)', async () => {
      mockAppToken('app-token-1');
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-1' } }).get('/data/wow/realm/1').query(true).reply(401);
      mockAppToken('app-token-2');
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-2' } })
        .get('/data/wow/realm/1')
        .query(true)
        .reply(200, fixture('realm-6855.json'));

      await expect(client.getRealm('eu', 1)).resolves.toMatchObject({ ruleset: 'NORMAL' });
    });

    it('gives up with BnetUnauthorizedError when a fresh token is rejected too', async () => {
      mockAppToken('app-token-1');
      mockAppToken('app-token-2');
      nock(EU).get('/data/wow/realm/1').query(true).times(2).reply(401);

      await expect(client.getRealm('eu', 1)).rejects.toBeInstanceOf(BnetUnauthorizedError);
    });

    it('throws BnetAuthError when the token endpoint refuses the credentials', async () => {
      nock(OAUTH).post('/token').reply(401, { error: 'invalid_client' });

      const error = (await client.getRealm('eu', 1).catch((e: unknown) => e)) as Error;

      expect(error).toBeInstanceOf(BnetAuthError);
      expect(error.message).not.toContain('client-secret');
    });
  });

  describe('getPublicCharacter', () => {
    const path = '/profile/wow/character/davina-asaria';

    it('returns 200 with the character and its Last-Modified', async () => {
      mockAppToken();
      nock(EU, { reqheaders: { authorization: 'Bearer app-token-1' } })
        .get(path)
        .query({ namespace: 'profile-forever-eu' })
        .reply(200, { level: 23, last_login_timestamp: 1_762_300_000_000 }, { 'Last-Modified': 'Wed, 05 Nov 2026 10:00:00 GMT' });

      const result = await client.getPublicCharacter('eu', 'Davina', 'Asaria');

      expect(result).toEqual({
        status: 200,
        character: { level: 23, last_login_timestamp: 1_762_300_000_000 },
        lastModified: 'Wed, 05 Nov 2026 10:00:00 GMT',
      });
    });

    it('sends If-Modified-Since and returns 304 when nothing changed', async () => {
      mockAppToken();
      nock(EU, { reqheaders: { 'if-modified-since': 'Wed, 05 Nov 2026 10:00:00 GMT' } })
        .get(path)
        .query({ namespace: 'profile-forever-eu' })
        .reply(304);

      await expect(
        client.getPublicCharacter('eu', 'Davina', 'Asaria', 'Wed, 05 Nov 2026 10:00:00 GMT'),
      ).resolves.toEqual({ status: 304 });
    });

    it('returns 404 when the public profile does not answer', async () => {
      mockAppToken();
      nock(EU).get(path).query(true).reply(404, fixture('account-profile.404.json'));

      await expect(client.getPublicCharacter('eu', 'Davina', 'Asaria')).resolves.toEqual({ status: 404 });
    });

    it('lowercases and encodes the first name and surname', async () => {
      mockAppToken();
      nock(EU).get('/profile/wow/character/%C3%A9lo%C3%AFse-dupr%C3%A9').query(true).reply(404);

      await expect(client.getPublicCharacter('eu', 'Éloïse', 'Dupré')).resolves.toEqual({ status: 404 });
    });
  });

  describe('429', () => {
    it('waits for Retry-After, then retries', async () => {
      mockAppToken();
      nock(EU).get('/data/wow/realm/6855').query(true).reply(429, '', { 'Retry-After': '3' });
      nock(EU).get('/data/wow/realm/6855').query(true).reply(200, fixture('realm-6855.json'));
      const start = clock.now();

      await expect(client.getRealm('eu', 6855)).resolves.toMatchObject({ ruleset: 'NORMAL' });
      expect(clock.now() - start).toBeGreaterThanOrEqual(3000);
    });

    it('waits 1 s by default when Retry-After is missing', async () => {
      nock(EU).get('/profile/user/wow').query(true).reply(429);
      nock(EU).get('/profile/user/wow').query(true).reply(200, { wow_accounts: [] });
      const start = clock.now();

      await client.getAccountProfile('eu', 'test-user-token');
      expect(clock.now() - start).toBeGreaterThanOrEqual(1000);
    });

    it('throws BnetRateLimitedError after 3 retries', async () => {
      nock(EU).get('/profile/user/wow').query(true).times(4).reply(429, '', { 'Retry-After': '1' });

      await expect(client.getAccountProfile('eu', 'test-user-token')).rejects.toBeInstanceOf(BnetRateLimitedError);
    });
  });
});
