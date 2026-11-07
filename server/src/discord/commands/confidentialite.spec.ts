import { MessageFlags } from 'discord.js';
import { PlayerAccountService } from '../../core/players/player-account.service';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import { privacyReply } from '../privacy/privacy-replies';
import type { CommandContext, CommandHandler } from '../registry/command-handler';
import { handlers } from './confidentialite';

const USER = '300000000000000001';
const handler = handlers.find((h) => h.key === 'confidentialite')!;
const VISIBLE = { hideMoney: false, hideZone: false, hidePresence: false };

function interaction(booleans: Record<string, boolean | null> = {}, inGuild = true) {
  return {
    guildId: '600000000000000001',
    user: { id: USER },
    inGuild: () => inGuild,
    options: { getBoolean: (name: string) => booleans[name] ?? null },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(account: Partial<Record<keyof PlayerAccountService, jest.Mock>>, markPlayerDirty = jest.fn()) {
  const providers = new Map<unknown, unknown>([
    [PlayerAccountService, account],
    [BoardPublisher, { markPlayerDirty }],
  ]);
  const ctx: CommandContext = { get: <T>(token: unknown) => providers.get(token) as T };
  return { ctx, markPlayerDirty };
}

const execute = (i: ReturnType<typeof interaction>, ctx: CommandContext) =>
  handler.execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);

describe('/confidentialite', () => {
  it('refuses outside a server', async () => {
    const i = interaction({}, false);
    await execute(i, context({}).ctx);
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  it('without options, shows the current settings ephemerally and changes nothing', async () => {
    const getPrivacy = jest.fn().mockResolvedValue(VISIBLE);
    const setPrivacy = jest.fn();
    const { ctx, markPlayerDirty } = context({ getPrivacy, setPrivacy });
    const i = interaction();

    await execute(i, ctx);

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(getPrivacy).toHaveBeenCalledWith(USER);
    expect(setPrivacy).not.toHaveBeenCalled();
    expect(markPlayerDirty).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ content: privacyReply(VISIBLE, false) });
  });

  it('updates only the given options, then has the boards redrawn', async () => {
    const updated = { hideMoney: true, hideZone: false, hidePresence: false };
    const setPrivacy = jest.fn().mockResolvedValue(updated);
    const { ctx, markPlayerDirty } = context({ setPrivacy });
    const i = interaction({ or: true, presence: false });

    await execute(i, ctx);

    expect(setPrivacy).toHaveBeenCalledWith(USER, { hideMoney: true, hidePresence: false });
    expect(markPlayerDirty).toHaveBeenCalledWith(USER);
    expect(i.editReply).toHaveBeenCalledWith({ content: privacyReply(updated, true) });
  });

  it('maps zone to hide_zone', async () => {
    const setPrivacy = jest.fn().mockResolvedValue({ ...VISIBLE, hideZone: true });
    const { ctx } = context({ setPrivacy });

    await execute(interaction({ zone: true }), ctx);

    expect(setPrivacy).toHaveBeenCalledWith(USER, { hideZone: true });
  });
});
