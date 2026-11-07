import { MessageFlags } from 'discord.js';
import { PlayerAccountService } from '../../core/players/player-account.service';
import { BoardPublisher } from '../board/board-publisher';
import { MSG } from '../messages';
import { QUIT_CONFIRM_TTL_MS, QUIT_IDS, QUIT_MSG, quitPrompt } from '../privacy/privacy-replies';
import type { CommandContext, CommandHandler, ComponentHandler } from '../registry/command-handler';
import { components, handlers } from './quitter';

const USER = '300000000000000001';
const NOW = new Date('2026-11-07T10:00:00Z').getTime();
const handler = handlers.find((h) => h.key === 'quitter')!;
const confirm = components.find((c) => c.customId === QUIT_IDS.confirm)!;
const cancel = components.find((c) => c.customId === QUIT_IDS.cancel)!;

function command(inGuild = true) {
  return {
    user: { id: USER },
    inGuild: () => inGuild,
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

/** A click on a button of the ephemeral prompt sent `ageMs` ago. */
function click(ageMs: number) {
  return {
    user: { id: USER },
    message: { createdTimestamp: NOW - ageMs },
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(quit = jest.fn()) {
  const markDirty = jest.fn();
  const providers = new Map<unknown, unknown>([
    [PlayerAccountService, { quit }],
    [BoardPublisher, { markDirty }],
  ]);
  const ctx: CommandContext = { get: <T>(token: unknown) => providers.get(token) as T };
  return { ctx, quit, markDirty };
}

const execute = (i: ReturnType<typeof command>, ctx: CommandContext) =>
  handler.execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);
const press = (c: ComponentHandler, i: ReturnType<typeof click>, ctx: CommandContext) =>
  c.execute(i as unknown as Parameters<ComponentHandler['execute']>[0], ctx);

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('/quitter', () => {
  it('refuses outside a server', async () => {
    const i = command(false);
    await execute(i, context().ctx);
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  it('asks for confirmation ephemerally and deletes nothing yet', async () => {
    const { ctx, quit } = context();
    const i = command();

    await execute(i, ctx);

    expect(i.reply).toHaveBeenCalledWith({ ...quitPrompt(new Date(NOW)), flags: MessageFlags.Ephemeral });
    expect(quit).not.toHaveBeenCalled();
  });

  it('on confirmation within 60 s, deletes the player and redraws the boards that showed them', async () => {
    const { ctx, quit, markDirty } = context(jest.fn().mockResolvedValue({ deleted: true, guildIds: ['g1', 'g2'] }));
    const i = click(QUIT_CONFIRM_TTL_MS - 1000);

    await press(confirm, i, ctx);

    expect(i.deferUpdate).toHaveBeenCalled();
    expect(quit).toHaveBeenCalledWith(USER);
    expect(markDirty.mock.calls).toEqual([['g1'], ['g2']]);
    expect(i.editReply).toHaveBeenCalledWith({ content: QUIT_MSG.done, components: [] });
  });

  it('says so when there was nothing to delete', async () => {
    const { ctx, markDirty } = context(jest.fn().mockResolvedValue({ deleted: false, guildIds: [] }));
    const i = click(1000);

    await press(confirm, i, ctx);

    expect(markDirty).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ content: QUIT_MSG.nothing, components: [] });
  });

  it('refuses a confirmation after 60 s and removes the buttons', async () => {
    const { ctx, quit } = context();
    const i = click(QUIT_CONFIRM_TTL_MS + 1);

    await press(confirm, i, ctx);

    expect(quit).not.toHaveBeenCalled();
    expect(i.update).toHaveBeenCalledWith({ content: QUIT_MSG.expired, components: [] });
  });

  it('cancel deletes nothing and removes the buttons', async () => {
    const { ctx, quit } = context();
    const i = click(1000);

    await press(cancel, i, ctx);

    expect(quit).not.toHaveBeenCalled();
    expect(i.update).toHaveBeenCalledWith({ content: QUIT_MSG.cancelled, components: [] });
  });
});
