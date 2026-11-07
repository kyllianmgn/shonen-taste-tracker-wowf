import nock from 'nock';
import { BnetClient } from '../../client';
import { FakeClock } from '../../client/testing/fake-clock';

export const EU = 'https://eu.api.blizzard.com';
export const PUBLIC_QUERY = { namespace: 'profile-forever-eu' };

/** A BnetClient whose app token request is mocked once (it is then cached). */
export function bnetClientWithAppToken(start: number): BnetClient {
  nock('https://oauth.battle.net')
    .post('/token', 'grant_type=client_credentials')
    .reply(200, { access_token: 'app-token', token_type: 'bearer', expires_in: 86_400 });
  return new BnetClient({ clientId: 'client-id', clientSecret: 'client-secret' }, new FakeClock(start));
}
