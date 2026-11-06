import { MessageFlags } from 'discord.js';
import { ManualSyncService, type ManualSyncInput, type ManualSyncOutcome } from '../../ingest/share-code/manual-sync.service';
import { MSG } from '../messages';
import type { CommandContext } from '../registry/command-handler';
import { renderManualSyncReply, SYNC_MSG } from '../sync/sync-replies';
import { handlers } from './sync';

const sync = handlers.find((h) => h.key === 'sync')!;
const DONE: ManualSyncOutcome = { status: 'done', results: [] };

function command(opts: { inGuild?: boolean; code?: string | null; file?: { url: string; size: number } | null } = {}) {
  return {
    guildId: opts.inGuild === false ? null : 'g1',
    user: { id: 'u1' },
    inGuild: () => opts.inGuild !== false,
    options: {
      getString: jest.fn().mockReturnValue(opts.code ?? null),
      getAttachment: jest.fn().mockReturnValue(opts.file ?? null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(run: jest.Mock): CommandContext {
  const providers = new Map<unknown, unknown>([[ManualSyncService, { run }]]);
  return { get: <T>(token: unknown) => providers.get(token) as T };
}

const exec = (i: ReturnType<typeof command>, ctx: CommandContext) =>
  sync.execute(i as unknown as Parameters<typeof sync.execute>[0], ctx);

describe('/sync command', () => {
  it('defers ephemerally, sends the code for the member and answers with the summary', async () => {
    const run = jest.fn().mockResolvedValue(DONE);
    const i = command({ code: 'FT1:abc' });

    await exec(i, context(run));

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(run).toHaveBeenCalledWith({ ownerId: 'u1', guildId: 'g1', input: { kind: 'code', text: 'FT1:abc' } });
    expect(i.editReply).toHaveBeenCalledWith({ content: renderManualSyncReply(DONE) });
  });

  it('sends a file as a lazy download, so the rate limit runs first', async () => {
    const run = jest.fn().mockResolvedValue({ status: 'refused', reason: 'download_failed' });
    const i = command({ file: { url: 'https://evil.example.com/f.lua', size: 10 } });

    await exec(i, context(run));

    const { input } = (run.mock.calls[0] as [{ input: ManualSyncInput }])[0];
    expect(input.kind).toBe('file');
    // The loader is the real downloader: a non-Discord URL is refused without any fetch.
    await expect(input.kind === 'file' && input.load()).rejects.toMatchObject({ reason: 'download_failed' });
    expect(i.editReply).toHaveBeenCalledWith({ content: SYNC_MSG.downloadFailed });
  });

  it.each([
    ['neither option', {}],
    ['both options', { code: 'FT1:abc', file: { url: 'https://cdn.discordapp.com/a.lua', size: 1 } }],
  ])('explains the usage with %s, without counting an attempt', async (_label, opts) => {
    const run = jest.fn();
    const i = command(opts);

    await exec(i, context(run));

    expect(i.reply).toHaveBeenCalledWith({ content: SYNC_MSG.usage, flags: MessageFlags.Ephemeral });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses outside a server', async () => {
    const run = jest.fn();
    const i = command({ inGuild: false, code: 'FT1:abc' });

    await exec(i, context(run));

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    expect(run).not.toHaveBeenCalled();
  });
});
