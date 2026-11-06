import { Logger } from '@nestjs/common';
import { Routes, type Client } from 'discord.js';
import type { AppConfig } from '../../common/config/config';
import type { LinkOutcome } from '../../bnet/oauth/link-outcome';
import { renderExpiredDm, renderLinkOutcome, renderTransferNotice } from './bnet-link-replies';
import { DiscordBnetLinkNotifier } from './discord-bnet-link-notifier';

const APP_ID = '100000000000000001';
const OUTCOME: LinkOutcome = {
  status: 'linked',
  region: 'eu',
  characters: [{ id: 1n, region: 'eu', firstName: 'Davina', surname: 'Asaria', level: 23, role: 'main', outcome: 'verified' }],
};

function setup() {
  const rest = {
    patch: jest.fn().mockResolvedValue({}),
    post: jest.fn((route: string) => Promise.resolve(route === Routes.userChannels() ? { id: 'dm-channel' } : {})),
  };
  const client = { rest } as unknown as Client;
  const notifier = new DiscordBnetLinkNotifier(client, { discordClientId: APP_ID } as AppConfig);
  return { rest, notifier };
}

const recipient = (interactionValid = true) => ({ userId: 'u1', interactionToken: 'itok', interactionValid });

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('DiscordBnetLinkNotifier.deliver', () => {
  it('edits the original ephemeral reply through the interaction webhook', async () => {
    const { rest, notifier } = setup();

    await expect(notifier.deliver(recipient(), OUTCOME)).resolves.toBe('edited');

    expect(rest.patch).toHaveBeenCalledWith(Routes.webhookMessage(APP_ID, 'itok', '@original'), {
      body: renderLinkOutcome(OUTCOME),
      auth: false,
    });
    expect(rest.post).not.toHaveBeenCalled();
  });

  it('sends a direct message instead once the interaction is known to have expired', async () => {
    const { rest, notifier } = setup();

    await expect(notifier.deliver(recipient(false), OUTCOME)).resolves.toBe('direct_message');

    expect(rest.patch).not.toHaveBeenCalled();
    expect(rest.post).toHaveBeenCalledWith(Routes.userChannels(), { body: { recipient_id: 'u1' } });
    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages('dm-channel'), { body: renderExpiredDm(OUTCOME) });
  });

  it('falls back to a direct message when Discord refuses the edit (expired webhook token)', async () => {
    const { rest, notifier } = setup();
    rest.patch.mockRejectedValue(Object.assign(new Error('Invalid Webhook Token'), { code: 50027, status: 401 }));

    await expect(notifier.deliver(recipient(), OUTCOME)).resolves.toBe('direct_message');

    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages('dm-channel'), { body: renderExpiredDm(OUTCOME) });
  });

  it('reports « undelivered » and logs, without the token, when the member’s DMs are closed', async () => {
    const { rest, notifier } = setup();
    rest.patch.mockRejectedValue(new Error('Unknown Webhook'));
    rest.post.mockRejectedValue(new Error('Cannot send messages to this user'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(notifier.deliver(recipient(), OUTCOME)).resolves.toBe('undelivered');

    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('u1');
    expect(logged).not.toContain('itok');
  });
});

describe('DiscordBnetLinkNotifier.notifyTransfer', () => {
  const notice = {
    character: { id: 3n, region: 'eu', firstName: 'Mira', surname: 'Sol' },
    fromUserId: '111',
    toUserId: '222',
  };

  it('posts the notice in each logs channel without pinging anyone', async () => {
    const { rest, notifier } = setup();

    await notifier.notifyTransfer(['c1', 'c2'], notice);

    const body = { content: renderTransferNotice(notice), allowed_mentions: { parse: [] } };
    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages('c1'), { body });
    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages('c2'), { body });
  });

  it('keeps going when one channel refuses the message', async () => {
    const { rest, notifier } = setup();
    rest.post.mockRejectedValueOnce(new Error('Missing Access'));

    await expect(notifier.notifyTransfer(['c1', 'c2'], notice)).resolves.toBeUndefined();

    expect(rest.post).toHaveBeenCalledTimes(2);
  });
});
