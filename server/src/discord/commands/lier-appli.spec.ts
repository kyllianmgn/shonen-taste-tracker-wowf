import { MessageFlags } from 'discord.js';
import { APP_CONFIG } from '../../common/config/config.constants';
import { PairingService } from '../../ingest/pairing/pairing.service';
import { MSG } from '../messages';
import type { CommandContext } from '../registry/command-handler';
import { formatLierAppliReply, handlers } from './lier-appli';

const lierAppli = handlers.find((h) => h.key === 'lier appli')!;
const DOWNLOAD_URL = 'https://example.org/releases';
const EXPIRES_AT = new Date('2026-11-06T12:10:00Z');

function interaction(opts: { inGuild?: boolean } = {}) {
  return {
    guildId: opts.inGuild === false ? null : 'g1',
    user: { id: 'u1' },
    inGuild: () => opts.inGuild !== false,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(issueCode: jest.Mock): CommandContext {
  const providers = new Map<unknown, unknown>([
    [PairingService, { issueCode }],
    [APP_CONFIG, { appDownloadUrl: DOWNLOAD_URL }],
  ]);
  return { get: <T>(token: unknown) => providers.get(token) as T };
}

const execute = (i: ReturnType<typeof interaction>, ctx: CommandContext) =>
  lierAppli.execute(i as unknown as Parameters<typeof lierAppli.execute>[0], ctx);

describe('/lier appli command', () => {
  it('defers ephemerally, issues a code for the member on this server and answers with the code and the download link', async () => {
    const issueCode = jest.fn().mockResolvedValue({ code: 'K7P29QXM', expiresAt: EXPIRES_AT });
    const i = interaction();

    await execute(i, context(issueCode));

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(issueCode).toHaveBeenCalledWith({ discordUserId: 'u1', guildId: 'g1' });
    expect(i.editReply).toHaveBeenCalledWith({ content: formatLierAppliReply('K7P29QXM', EXPIRES_AT, DOWNLOAD_URL) });
  });

  it('refuses outside a server without issuing a code', async () => {
    const issueCode = jest.fn();
    const i = interaction({ inGuild: false });

    await execute(i, context(issueCode));

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    expect(issueCode).not.toHaveBeenCalled();
  });
});

describe('formatLierAppliReply', () => {
  const text = formatLierAppliReply('K7P29QXM', EXPIRES_AT, DOWNLOAD_URL);

  it('shows the code, the expiry as a Discord timestamp, single use and the download link, in French', () => {
    expect(text).toContain('`K7P29QXM`');
    const unix = EXPIRES_AT.getTime() / 1000;
    expect(text).toContain(`<t:${unix}:R>`);
    expect(text).toContain('10 minutes');
    expect(text).toMatch(/une seule fois/);
    expect(text).toContain(DOWNLOAD_URL);
  });

  it('fits in one Discord message', () => {
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
