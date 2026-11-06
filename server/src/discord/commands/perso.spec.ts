import { MessageFlags } from 'discord.js';
import { OauthStateService } from '../../bnet/oauth/oauth-state.service';
import { APP_CONFIG } from '../../common/config/config.constants';
import { CharacterService } from '../../core/characters/character.service';
import { PlayerModeService } from '../../core/players/player-mode.service';
import { renderLierBattlenetReply } from '../bnet-link/bnet-link-replies';
import type { OwnedCharacter } from '../../core/characters/character.types';
import { MSG } from '../messages';
import { addReply, listMessage, listReply, PERSO_IDS, PERSO_MSG, setMainReply, untrackReply } from '../perso/perso-replies';
import type { CommandContext, CommandHandler } from '../registry/command-handler';
import { components, handlers } from './perso';

const USER = '300000000000000001';
const GUILD = '600000000000000001';

const handler = (key: string) => handlers.find((h) => h.key === key)!;

const DAVINA: OwnedCharacter = {
  id: 1n,
  region: 'eu',
  firstName: 'Davina',
  surname: 'Asaria',
  role: 'main',
  bnetVerified: false,
  lastSyncAt: null,
};
const BOREK: OwnedCharacter = { ...DAVINA, id: 2n, firstName: 'Borek', surname: 'Tanu', role: 'alt' };

function interaction(strings: Record<string, string | null> = {}, opts: { inGuild?: boolean; focused?: string } = {}) {
  return {
    guildId: GUILD,
    user: { id: USER },
    inGuild: () => opts.inGuild ?? true,
    options: {
      getString: (name: string) => strings[name] ?? null,
      getFocused: () => opts.focused ?? '',
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

function context(
  service: Partial<Record<keyof CharacterService, jest.Mock>>,
  extra: { bnetRelinkRegion?: jest.Mock; issue?: jest.Mock } = {},
): CommandContext {
  const providers = new Map<unknown, unknown>([
    [CharacterService, service],
    [PlayerModeService, { bnetRelinkRegion: extra.bnetRelinkRegion ?? jest.fn().mockResolvedValue(null) }],
    [OauthStateService, { issue: extra.issue }],
    [APP_CONFIG, { bnetDefaultRegion: 'eu' }],
  ]);
  return {
    get: <T>(token: unknown) => {
      if (!providers.has(token)) throw new Error('unexpected provider');
      return providers.get(token) as T;
    },
  };
}

type Fake = ReturnType<typeof interaction>;
const execute = (h: CommandHandler, i: Fake, ctx: CommandContext) =>
  h.execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);
const complete = (h: CommandHandler, i: Fake, ctx: CommandContext) =>
  h.autocomplete!(i as unknown as Parameters<NonNullable<CommandHandler['autocomplete']>>[0], ctx);

describe('/perso commands', () => {
  it('declares the four subcommands', () => {
    expect(handlers.map((h) => h.key).sort()).toEqual(['perso ajouter', 'perso liste', 'perso principal', 'perso retirer']);
  });

  it.each(['perso ajouter', 'perso principal', 'perso retirer', 'perso liste'])('%s refuses outside a server', async (key) => {
    const i = interaction({}, { inGuild: false });
    await execute(handler(key), i, context({}));
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  describe('ajouter', () => {
    it('defers ephemerally, passes the options (EU by default) and answers', async () => {
      const result = { status: 'added', character: DAVINA, role: 'main', created: true } as const;
      const add = jest.fn().mockResolvedValue(result);
      const i = interaction({ prenom: 'davina', nom: 'asaria' });

      await execute(handler('perso ajouter'), i, context({ add }));

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(add).toHaveBeenCalledWith({
        ownerId: USER,
        guildId: GUILD,
        region: 'eu',
        firstName: 'davina',
        surname: 'asaria',
        role: undefined,
      });
      expect(i.editReply).toHaveBeenCalledWith({ content: addReply(result) });
    });

    it('passes the chosen region and role, and the asked role to the reply', async () => {
      const result = { status: 'already_tracked', character: BOREK, role: 'alt' } as const;
      const add = jest.fn().mockResolvedValue(result);
      const i = interaction({ prenom: 'Borek', nom: 'Tanu', region: 'us', role: 'main' });

      await execute(handler('perso ajouter'), i, context({ add }));

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ region: 'us', role: 'main' }));
      expect(i.editReply).toHaveBeenCalledWith({ content: addReply(result, 'main') });
    });
  });

  describe('principal', () => {
    it('resolves the picked character among the member’s own and promotes it', async () => {
      const list = jest.fn().mockResolvedValue([DAVINA, BOREK]);
      const result = { status: 'promoted', character: BOREK, demoted: DAVINA } as const;
      const setMain = jest.fn().mockResolvedValue(result);
      const i = interaction({ perso: '2' });

      await execute(handler('perso principal'), i, context({ list, setMain }));

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(list).toHaveBeenCalledWith(USER);
      expect(setMain).toHaveBeenCalledWith(USER, 2n);
      expect(i.editReply).toHaveBeenCalledWith({ content: setMainReply(result) });
    });

    it('answers « not found » for a pick that matches none of the member’s characters', async () => {
      const setMain = jest.fn();
      const i = interaction({ perso: 'Nobody Here' });

      await execute(handler('perso principal'), i, context({ list: jest.fn().mockResolvedValue([DAVINA]), setMain }));

      expect(setMain).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: PERSO_MSG.notFound });
    });

    it('autocompletes with the member’s characters except the main', async () => {
      const i = interaction({}, { focused: 'bor' });

      await complete(handler('perso principal'), i, context({ list: jest.fn().mockResolvedValue([DAVINA, BOREK]) }));

      expect(i.respond).toHaveBeenCalledWith([{ name: 'Borek Tanu (EU) · secondaire', value: '2' }]);
    });

    it('autocompletes nothing outside a server', async () => {
      const list = jest.fn();
      const i = interaction({}, { inGuild: false });

      await complete(handler('perso principal'), i, context({ list }));

      expect(i.respond).toHaveBeenCalledWith([]);
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('retirer', () => {
    it('untracks the picked character', async () => {
      const result = { status: 'untracked', character: DAVINA } as const;
      const untrack = jest.fn().mockResolvedValue(result);
      const i = interaction({ perso: 'Davina Asaria' });

      await execute(handler('perso retirer'), i, context({ list: jest.fn().mockResolvedValue([DAVINA]), untrack }));

      expect(untrack).toHaveBeenCalledWith(USER, 1n);
      expect(i.editReply).toHaveBeenCalledWith({ content: untrackReply(result) });
    });

    it('autocompletes with tracked characters only', async () => {
      const i = interaction();
      const oldie: OwnedCharacter = { ...DAVINA, id: 3n, firstName: 'Oldie', role: 'untracked' };

      await complete(handler('perso retirer'), i, context({ list: jest.fn().mockResolvedValue([DAVINA, BOREK, oldie]) }));

      expect((i.respond.mock.calls[0] as [{ value: string }[]])[0].map((c) => c.value)).toEqual(['1', '2']);
    });
  });

  describe('liste', () => {
    it('lists the member’s characters ephemerally', async () => {
      const i = interaction();

      await execute(handler('perso liste'), i, context({ list: jest.fn().mockResolvedValue([DAVINA, BOREK]) }));

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(i.editReply).toHaveBeenCalledWith({ content: listReply([DAVINA, BOREK]) });
    });

    it('adds the « Relier Battle.net » button when the base-mode token has expired', async () => {
      const i = interaction();
      const bnetRelinkRegion = jest.fn().mockResolvedValue('eu');

      await execute(handler('perso liste'), i, context({ list: jest.fn().mockResolvedValue([DAVINA]) }, { bnetRelinkRegion }));

      expect(bnetRelinkRegion).toHaveBeenCalledWith(USER);
      expect(i.editReply).toHaveBeenCalledWith(listMessage([DAVINA], true));
    });
  });

  describe('« Relier Battle.net » button', () => {
    const relink = components.find((c) => c.customId === PERSO_IDS.relinkBnet)!;
    const button = (inGuild = true) => ({ ...interaction({}, { inGuild }), token: 'button-token' });
    const press = (i: ReturnType<typeof button>, ctx: CommandContext) =>
      relink.execute(i as unknown as Parameters<typeof relink.execute>[0], ctx);

    it('starts /lier battlenet in the region of the expired link, tied to the button interaction', async () => {
      const expiresAt = new Date('2026-11-06T12:10:00Z');
      const issue = jest.fn().mockResolvedValue({ url: 'https://oauth.battle.net/authorize?state=s', expiresAt });
      const i = button();

      await press(i, context({}, { issue, bnetRelinkRegion: jest.fn().mockResolvedValue('us') }));

      expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(issue).toHaveBeenCalledWith({ ownerId: USER, guildId: GUILD, region: 'us', interactionToken: 'button-token' });
      expect(i.editReply).toHaveBeenCalledWith(renderLierBattlenetReply('https://oauth.battle.net/authorize?state=s', 'us', expiresAt));
    });

    it('falls back to BNET_DEFAULT_REGION when no expired link is known any more', async () => {
      const issue = jest.fn().mockResolvedValue({ url: 'https://x', expiresAt: new Date() });

      await press(button(), context({}, { issue }));

      expect(issue).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu' }));
    });

    it('refuses outside a server', async () => {
      const issue = jest.fn();
      const i = button(false);

      await press(i, context({}, { issue }));

      expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
      expect(issue).not.toHaveBeenCalled();
    });
  });
});
