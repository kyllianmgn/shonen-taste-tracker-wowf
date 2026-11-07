import { Logger } from '@nestjs/common';
import nock from 'nock';
import { PublicProfileGate } from './public-profile-gate';
import { PublicProfileProbe } from './public-profile-probe.service';
import { bnetClientWithAppToken, EU, PUBLIC_QUERY } from './testing/bnet-nock';
import { InMemoryPublicPollStore } from './testing/in-memory-public-poll.store';

const START = Date.UTC(2026, 10, 7, 4);

describe('PublicProfileProbe', () => {
  let store: InMemoryPublicPollStore;
  let gate: PublicProfileGate;
  let logs: string[];

  beforeAll(() => nock.disableNetConnect());
  afterAll(() => nock.enableNetConnect());

  beforeEach(() => {
    nock.cleanAll();
    store = new InMemoryPublicPollStore();
    gate = new PublicProfileGate();
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void logs.push(String(args[0])));
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const pending = nock.pendingMocks().filter((m) => !m.includes('oauth.battle.net'));
    nock.cleanAll();
    expect(pending).toEqual([]);
  });

  const probe = (bnetPublicProfile: boolean) =>
    new PublicProfileProbe(store, bnetClientWithAppToken(START), gate, { bnetPublicProfile });

  const verified = (level: number) =>
    store.add({
      characterId: 7n,
      ownerId: 'u1',
      role: 'main',
      region: 'eu',
      firstName: 'Davina',
      surname: 'Asaria',
      verified: true,
      snapshots: [{ id: 1n, level, capturedAt: new Date(START), source: 'bnet_account' }],
    });

  it('logs that the public profile is still closed on 404 and leaves readings off', async () => {
    verified(21);
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(404);

    await expect(probe(true).run()).resolves.toBe('closed');
    expect(gate.enabled).toBe(false);
    expect(logs.join('\n')).toMatch(/404/);
  });

  it('enables public readings on 200 when BNET_PUBLIC_PROFILE is true', async () => {
    verified(21);
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(200, { level: 21 });

    await expect(probe(true).run()).resolves.toBe('open');
    expect(gate.enabled).toBe(true);
  });

  it('only logs a 200 when BNET_PUBLIC_PROFILE is false', async () => {
    verified(21);
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(200, { level: 21 });

    await expect(probe(false).run()).resolves.toBe('open');
    expect(gate.enabled).toBe(false);
    expect(logs.join('\n')).toMatch(/BNET_PUBLIC_PROFILE/);
  });

  it('never sends the If-Modified-Since header, so a 304 cannot hide the answer', async () => {
    verified(21);
    nock(EU, { badheaders: ['if-modified-since'] })
      .get('/profile/wow/character/davina-asaria')
      .query(PUBLIC_QUERY)
      .reply(200, { level: 21 });
    await expect(probe(true).run()).resolves.toBe('open');
  });

  it('skips the test without a verified character of level 10+', async () => {
    verified(9);
    await expect(probe(true).run()).resolves.toBe('no_candidate');
    expect(gate.enabled).toBe(false);
  });

  it('keeps the gate as it is when Battle.net fails', async () => {
    verified(21);
    gate.enable();
    nock(EU).get('/profile/wow/character/davina-asaria').query(PUBLIC_QUERY).reply(503);

    await expect(probe(true).run()).resolves.toBe('error');
    expect(gate.enabled).toBe(true);
  });
});
