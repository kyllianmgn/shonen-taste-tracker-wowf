import { MessageFlags } from 'discord.js';
import { CharacterService } from '../../core/characters/character.service';
import type { OwnedCharacter } from '../../core/characters/character.types';
import { MSG } from '../messages';
import { PROFILE_MSG } from '../profile/profile-replies';
import { ProfileQueryService } from '../profile/profile-query.service';
import { renderLeaderboard, renderProfile, renderSession, type ProfileInput, type SessionInput } from '../render/profile';
import type { CommandContext, CommandHandler } from '../registry/command-handler';
import { handlers as classementHandlers } from './classement';
import { handlers as profilHandlers } from './profil';
import { handlers as sessionHandlers } from './session';

const USER = '300000000000000001';
const MEMBER = '300000000000000002';
const GUILD = '600000000000000001';
const NO_PINGS = { parse: [] };

const DAVINA: OwnedCharacter = {
  id: 1n,
  region: 'eu',
  firstName: 'Davina',
  surname: 'Asaria',
  role: 'main',
  bnetVerified: false,
  lastSyncAt: null,
};
const BROM: OwnedCharacter = { ...DAVINA, id: 2n, firstName: 'Brom', surname: 'Ferrepied', role: 'alt' };
const OLD: OwnedCharacter = { ...DAVINA, id: 3n, firstName: 'Ilsa', surname: 'Ventbrume', role: 'untracked' };

const PROFILE: ProfileInput = {
  discordUserId: USER,
  privacy: { hideMoney: false, hideZone: false, hidePresence: false },
  character: { firstName: 'Davina', surname: 'Asaria', classFile: 'PRIEST', role: 'main' },
  snapshot: null,
  levels: [],
};

interface FakeOptions {
  strings?: Record<string, string | null>;
  member?: { id: string } | null;
  inGuild?: boolean;
  focused?: string;
  /** Raw `membre` option of an autocomplete interaction (a user id). */
  rawMember?: string;
}

function interaction(opts: FakeOptions = {}) {
  return {
    guildId: GUILD,
    user: { id: USER },
    inGuild: () => opts.inGuild ?? true,
    options: {
      getString: (name: string) => opts.strings?.[name] ?? null,
      getUser: (name: string) => (name === 'membre' ? (opts.member ?? null) : null),
      get: (name: string) => (name === 'membre' && opts.rawMember ? { value: opts.rawMember } : null),
      getFocused: () => opts.focused ?? '',
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

function context(
  query: Partial<Record<keyof ProfileQueryService, jest.Mock>>,
  characters: Partial<Record<keyof CharacterService, jest.Mock>> = {},
): CommandContext {
  return {
    get: <T>(token: unknown) => {
      if (token === ProfileQueryService) return query as unknown as T;
      if (token === CharacterService) return characters as unknown as T;
      throw new Error('unexpected provider');
    },
  };
}

type Fake = ReturnType<typeof interaction>;
const execute = (h: CommandHandler, i: Fake, ctx: CommandContext) =>
  h.execute(i as unknown as Parameters<CommandHandler['execute']>[0], ctx);
const complete = (h: CommandHandler, i: Fake, ctx: CommandContext) =>
  h.autocomplete!(i as unknown as Parameters<NonNullable<CommandHandler['autocomplete']>>[0], ctx);

const profil = profilHandlers[0];
const session = sessionHandlers[0];
const classement = classementHandlers[0];

describe('/profil, /session, /classement', () => {
  it('declares one handler per command', () => {
    expect([profilHandlers, sessionHandlers, classementHandlers].map((hs) => hs.map((h) => h.key))).toEqual([
      ['profil'],
      ['session'],
      ['classement'],
    ]);
  });

  it.each([
    ['profil', profil],
    ['session', session],
    ['classement', classement],
  ])('/%s refuses outside a server', async (_name, handler) => {
    const i = interaction({ inGuild: false });
    await execute(handler, i, context({}));
    expect(i.reply).toHaveBeenCalledWith({ content: MSG.guildOnly, flags: MessageFlags.Ephemeral });
  });

  describe('/profil', () => {
    it('answers publicly with the main character of the caller by default', async () => {
      const isMember = jest.fn().mockResolvedValue(true);
      const profile = jest.fn().mockResolvedValue(PROFILE);
      const list = jest.fn().mockResolvedValue([DAVINA, BROM]);
      const i = interaction();

      await execute(profil, i, context({ isMember, profile }, { list }));

      expect(i.deferReply).toHaveBeenCalledWith();
      expect(isMember).toHaveBeenCalledWith(GUILD, USER);
      expect(list).toHaveBeenCalledWith(USER);
      expect(profile).toHaveBeenCalledWith(USER, DAVINA.id);
      expect(i.editReply).toHaveBeenCalledWith({ content: renderProfile(PROFILE), allowedMentions: NO_PINGS });
    });

    it('shows the picked character of another member', async () => {
      const profile = jest.fn().mockResolvedValue(PROFILE);
      const list = jest.fn().mockResolvedValue([DAVINA, BROM]);
      const i = interaction({ member: { id: MEMBER }, strings: { perso: '2' } });

      await execute(profil, i, context({ isMember: jest.fn().mockResolvedValue(true), profile }, { list }));

      expect(list).toHaveBeenCalledWith(MEMBER);
      expect(profile).toHaveBeenCalledWith(MEMBER, BROM.id);
    });

    it('refuses a member who is not tracked on this server', async () => {
      const list = jest.fn();
      const i = interaction({ member: { id: MEMBER } });

      await execute(profil, i, context({ isMember: jest.fn().mockResolvedValue(false) }, { list }));

      expect(list).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: PROFILE_MSG.notMember(MEMBER), allowedMentions: NO_PINGS });
    });

    it('does not show an untracked character', async () => {
      const profile = jest.fn();
      const i = interaction({ strings: { perso: 'Ilsa Ventbrume' } });

      await execute(
        profil,
        i,
        context({ isMember: jest.fn().mockResolvedValue(true), profile }, { list: jest.fn().mockResolvedValue([DAVINA, OLD]) }),
      );

      expect(profile).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: PROFILE_MSG.characterNotFound, allowedMentions: NO_PINGS });
    });

    it('asks for a character when the member has no main', async () => {
      const i = interaction();

      await execute(
        profil,
        i,
        context({ isMember: jest.fn().mockResolvedValue(true) }, { list: jest.fn().mockResolvedValue([BROM]) }),
      );

      expect(i.editReply).toHaveBeenCalledWith({ content: PROFILE_MSG.noMain(USER), allowedMentions: NO_PINGS });
    });

    it('autocompletes the tracked characters of the chosen member', async () => {
      const list = jest.fn().mockResolvedValue([DAVINA, BROM, OLD]);
      const i = interaction({ rawMember: MEMBER });

      await complete(profil, i, context({ isMember: jest.fn().mockResolvedValue(true) }, { list }));

      expect(list).toHaveBeenCalledWith(MEMBER);
      expect(i.respond).toHaveBeenCalledWith([
        { name: 'Davina Asaria (EU) · principal', value: '1' },
        { name: 'Brom Ferrepied (EU) · secondaire', value: '2' },
      ]);
    });

    it('autocompletes nothing for someone who is not tracked on this server', async () => {
      const list = jest.fn();
      const i = interaction({ rawMember: MEMBER });

      await complete(profil, i, context({ isMember: jest.fn().mockResolvedValue(false) }, { list }));

      expect(list).not.toHaveBeenCalled();
      expect(i.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('/session', () => {
    const SESSION: SessionInput = {
      discordUserId: MEMBER,
      privacy: { hideMoney: false, hideZone: false, hidePresence: false },
      character: { firstName: 'Davina', surname: 'Asaria' },
      startedAt: new Date('2026-11-06T10:00:00Z'),
      endedAt: new Date('2026-11-06T11:00:00Z'),
      levelStart: 21,
      levelEnd: 22,
      moneyStart: null,
      moneyEnd: null,
      playedStart: null,
      playedEnd: null,
      zone: null,
      subZone: null,
      deaths: 0,
    };

    it('answers publicly with the recap of the chosen member', async () => {
      const sessionQuery = jest.fn().mockResolvedValue(SESSION);
      const i = interaction({ member: { id: MEMBER } });

      await execute(session, i, context({ isMember: jest.fn().mockResolvedValue(true), session: sessionQuery }));

      expect(i.deferReply).toHaveBeenCalledWith();
      expect(sessionQuery).toHaveBeenCalledWith(MEMBER, expect.any(Date));
      const now = sessionQuery.mock.calls[0][1] as Date;
      expect(i.editReply).toHaveBeenCalledWith({ content: renderSession(SESSION, now), allowedMentions: NO_PINGS });
    });

    it('says when there is no session yet', async () => {
      const i = interaction();

      await execute(
        session,
        i,
        context({ isMember: jest.fn().mockResolvedValue(true), session: jest.fn().mockResolvedValue(null) }),
      );

      expect(i.editReply).toHaveBeenCalledWith({ content: PROFILE_MSG.noSession(USER), allowedMentions: NO_PINGS });
    });

    it('refuses a member who is not tracked on this server', async () => {
      const sessionQuery = jest.fn();
      const i = interaction({ member: { id: MEMBER } });

      await execute(session, i, context({ isMember: jest.fn().mockResolvedValue(false), session: sessionQuery }));

      expect(sessionQuery).not.toHaveBeenCalled();
      expect(i.editReply).toHaveBeenCalledWith({ content: PROFILE_MSG.notMember(MEMBER), allowedMentions: NO_PINGS });
    });
  });

  describe('/classement', () => {
    it('ranks the members of the server publicly, by level by default', async () => {
      const leaderboard = jest.fn().mockResolvedValue([]);
      const i = interaction();

      await execute(classement, i, context({ leaderboard }));

      expect(i.deferReply).toHaveBeenCalledWith();
      expect(leaderboard).toHaveBeenCalledWith(GUILD);
      expect(i.editReply).toHaveBeenCalledWith({
        content: renderLeaderboard({ criterion: 'level', entries: [] }),
        allowedMentions: NO_PINGS,
      });
    });

    it('uses the chosen criterion', async () => {
      const i = interaction({ strings: { critere: 'money' } });

      await execute(classement, i, context({ leaderboard: jest.fn().mockResolvedValue([]) }));

      expect(i.editReply).toHaveBeenCalledWith({
        content: renderLeaderboard({ criterion: 'money', entries: [] }),
        allowedMentions: NO_PINGS,
      });
    });
  });
});
