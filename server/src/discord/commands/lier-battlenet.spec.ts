import { MessageFlags } from 'discord.js';
import { OauthStateService } from '../../bnet/oauth/oauth-state.service';
import { APP_CONFIG } from '../../common/config/config.constants';
import { CharacterService } from '../../core/characters/character.service';
import { BNET_SELECT_IDS, renderLierBattlenetReply, setAltReply } from '../bnet-link/bnet-link-replies';
import { MSG } from '../messages';
import { PERSO_MSG, setMainReply } from '../perso/perso-replies';
import type { CommandContext } from '../registry/command-handler';
import { components, handlers } from './lier-battlenet';

const lierBattlenet = handlers.find((h) => h.key === 'lier battlenet')!;
const mainMenu = components.find((c) => c.customId === BNET_SELECT_IDS.main)!;
const altMenu = components.find((c) => c.customId === BNET_SELECT_IDS.alt)!;
const EXPIRES_AT = new Date('2026-11-06T12:10:00Z');
const URL = 'https://oauth.battle.net/authorize?state=s';

function command(opts: { inGuild?: boolean; region?: string | null } = {}) {
  return {
    guildId: opts.inGuild === false ? null : 'g1',
    user: { id: 'u1' },
    token: 'interaction-token',
    inGuild: () => opts.inGuild !== false,
    options: { getString: jest.fn().mockReturnValue(opts.region ?? null) },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function select(values: string[], isSelect = true) {
  return {
    user: { id: 'u1' },
    values,
    isStringSelectMenu: () => isSelect,
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

function context(services: { issue?: jest.Mock; setMain?: jest.Mock; setAlt?: jest.Mock }): CommandContext {
  const providers = new Map<unknown, unknown>([
    [OauthStateService, { issue: services.issue }],
    [CharacterService, { setMain: services.setMain, setAlt: services.setAlt }],
    [APP_CONFIG, { bnetDefaultRegion: 'us' }],
  ]);
  return { get: <T>(token: unknown) => providers.get(token) as T };
}

const run = (i: ReturnType<typeof command>, ctx: CommandContext) =>
  lierBattlenet.execute(i as unknown as Parameters<typeof lierBattlenet.execute>[0], ctx);
const pick = (menu: typeof mainMenu, i: ReturnType<typeof select>, ctx: CommandContext) =>
  menu.execute(i as unknown as Parameters<typeof menu.execute>[0], ctx);

describe('/lier battlenet command', () => {
  it('defers ephemerally, creates a state tied to the member, the server and the interaction token, and answers with the link', async () => {
    const issue = jest.fn().mockResolvedValue({ url: URL, expiresAt: EXPIRES_AT });
    const i = command({ region: 'kr' });

    await run(i, context({ issue }));

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(issue).toHaveBeenCalledWith({ ownerId: 'u1', guildId: 'g1', region: 'kr', interactionToken: 'interaction-token' });
    expect(i.editReply).toHaveBeenCalledWith(renderLierBattlenetReply(URL, 'kr', EXPIRES_AT));
  });

  it('uses BNET_DEFAULT_REGION without the option', async () => {
    const issue = jest.fn().mockResolvedValue({ url: URL, expiresAt: EXPIRES_AT });

    await run(command(), context({ issue }));

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ region: 'us' }));
  });

  it('refuses outside a server without creating a state', async () => {
    const issue = jest.fn();
    const i = command({ inGuild: false });

    await run(i, context({ issue }));

    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('Battle.net menus', () => {
  it('« principal » makes the chosen character main, ephemerally', async () => {
    const result = { status: 'promoted', character: { id: 7n, region: 'eu', firstName: 'Kael', surname: 'Ombre' }, demoted: null };
    const setMain = jest.fn().mockResolvedValue(result);
    const i = select(['7']);

    await pick(mainMenu, i, context({ setMain }));

    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(setMain).toHaveBeenCalledWith('u1', 7n);
    expect(i.editReply).toHaveBeenCalledWith({ content: setMainReply(result as never) });
  });

  it('« secondaire » makes the chosen character alt', async () => {
    const result = { status: 'set', character: { id: 8n, region: 'eu', firstName: 'Mira', surname: 'Sol' }, replaced: null };
    const setAlt = jest.fn().mockResolvedValue(result);
    const i = select(['8']);

    await pick(altMenu, i, context({ setAlt }));

    expect(setAlt).toHaveBeenCalledWith('u1', 8n);
    expect(i.editReply).toHaveBeenCalledWith({ content: setAltReply(result as never) });
  });

  it.each([[['abc']], [[]], [['-1']], [['1.5']]])('answers « introuvable » for the value %p', async (values) => {
    const setMain = jest.fn();
    const i = select(values);

    await pick(mainMenu, i, context({ setMain }));

    expect(setMain).not.toHaveBeenCalled();
    expect(i.editReply).toHaveBeenCalledWith({ content: PERSO_MSG.notFound });
  });
});
