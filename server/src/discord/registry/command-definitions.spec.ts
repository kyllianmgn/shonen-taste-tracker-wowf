import {
  ApplicationCommandOptionType as T,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  type APIApplicationCommandOption,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { COMMAND_DEFINITIONS, commandKeys } from './command-definitions';

type Option = APIApplicationCommandOption & {
  required?: boolean;
  autocomplete?: boolean;
  choices?: { name: string; value: string | number }[];
  channel_types?: ChannelType[];
  options?: Option[];
};

const byName = (name: string): RESTPostAPIChatInputApplicationCommandsJSONBody => {
  const def = COMMAND_DEFINITIONS.find((c) => c.name === name);
  if (!def) throw new Error(`no command ${name}`);
  return def;
};
const sub = (command: string, name: string): Option => {
  const option = (byName(command).options)?.find((o) => o.name === name);
  if (!option) throw new Error(`no subcommand ${command} ${name}`);
  expect(option.type).toBe(T.Subcommand);
  return option;
};
/** Compact view of options: name, type, required, autocomplete, choices. */
const shape = (options: Option[] | undefined) =>
  (options ?? []).map((o) => ({
    name: o.name,
    type: o.type,
    required: o.required ?? false,
    ...(o.autocomplete ? { autocomplete: true } : {}),
    ...(o.choices ? { choices: o.choices.map((c) => [c.name, c.value]) } : {}),
  }));

const REGION_CHOICES = [
  ['EU', 'eu'],
  ['US', 'us'],
  ['KR', 'kr'],
  ['TW', 'tw'],
];
const ROLE_CHOICES = [
  ['principal', 'main'],
  ['secondaire', 'alt'],
];

describe('slash command definitions (docs/02 « Commandes Discord »)', () => {
  it('declares every top-level command of the spec, and only those', () => {
    expect(COMMAND_DEFINITIONS.map((c) => c.name).sort()).toEqual(
      [
        'admin',
        'classement',
        'confidentialite',
        'config',
        'lier',
        'perso',
        'profil',
        'quitter',
        'session',
        'setup',
        'sync',
      ].sort(),
    );
  });

  it('exposes one handler key per leaf command', () => {
    expect([...commandKeys()].sort()).toEqual(
      [
        'admin perso',
        'admin rafraichir',
        'admin suspects',
        'classement',
        'confidentialite',
        'config',
        'lier appli',
        'lier battlenet',
        'perso ajouter',
        'perso liste',
        'perso principal',
        'perso retirer',
        'profil',
        'quitter',
        'session',
        'setup',
        'sync',
      ].sort(),
    );
  });

  it('gives every command and option a French description within Discord limits', () => {
    const check = (name: string, description: string) => {
      expect(name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(100);
    };
    const walk = (options: Option[] | undefined) =>
      (options ?? []).forEach((o) => {
        check(o.name, o.description);
        walk(o.options);
      });
    for (const def of COMMAND_DEFINITIONS) {
      check(def.name, def.description);
      walk(def.options);
    }
  });

  it('makes every command usable in servers only', () => {
    for (const def of COMMAND_DEFINITIONS) {
      expect(def.contexts).toEqual([InteractionContextType.Guild]);
    }
  });

  it('restricts admin commands to Manage Server by default, and only them', () => {
    const manageGuild = PermissionFlagsBits.ManageGuild.toString();
    for (const def of COMMAND_DEFINITIONS) {
      const admin = ['setup', 'config', 'admin'].includes(def.name);
      expect([def.name, def.default_member_permissions ?? null]).toEqual([def.name, admin ? manageGuild : null]);
    }
  });

  describe('player commands', () => {
    it('/lier has the appli and battlenet subcommands without options', () => {
      expect(shape(byName('lier').options as Option[])).toEqual([
        { name: 'appli', type: T.Subcommand, required: false },
        { name: 'battlenet', type: T.Subcommand, required: false },
      ]);
    });

    it('/perso ajouter takes prenom, nom, region (EU, US, KR, TW) and role (principal, secondaire)', () => {
      expect(shape(sub('perso', 'ajouter').options)).toEqual([
        { name: 'prenom', type: T.String, required: true },
        { name: 'nom', type: T.String, required: true },
        { name: 'region', type: T.String, required: false, choices: REGION_CHOICES },
        { name: 'role', type: T.String, required: false, choices: ROLE_CHOICES },
      ]);
    });

    it('/perso principal and /perso retirer take an autocompleted perso', () => {
      for (const name of ['principal', 'retirer']) {
        expect(shape(sub('perso', name).options)).toEqual([
          { name: 'perso', type: T.String, required: true, autocomplete: true },
        ]);
      }
      expect(shape(sub('perso', 'liste').options)).toEqual([]);
    });

    it('/profil takes an optional membre and an optional autocompleted perso', () => {
      expect(shape(byName('profil').options as Option[])).toEqual([
        { name: 'membre', type: T.User, required: false },
        { name: 'perso', type: T.String, required: false, autocomplete: true },
      ]);
    });

    it('/session takes an optional membre', () => {
      expect(shape(byName('session').options as Option[])).toEqual([
        { name: 'membre', type: T.User, required: false },
      ]);
    });

    it('/classement offers the five criteria', () => {
      expect(shape(byName('classement').options as Option[])).toEqual([
        {
          name: 'critere',
          type: T.String,
          required: false,
          choices: [
            ['niveau', 'level'],
            ['temps joué', 'played'],
            ['rythme', 'pace'],
            ['or', 'money'],
            ['morts', 'deaths'],
          ],
        },
      ]);
    });

    it('/confidentialite takes three optional booleans', () => {
      expect(shape(byName('confidentialite').options as Option[])).toEqual([
        { name: 'or', type: T.Boolean, required: false },
        { name: 'zone', type: T.Boolean, required: false },
        { name: 'presence', type: T.Boolean, required: false },
      ]);
    });

    it('/quitter has no option', () => {
      expect(shape(byName('quitter').options as Option[])).toEqual([]);
    });

    it('/sync takes a code text or a fichier attachment', () => {
      expect(shape(byName('sync').options as Option[])).toEqual([
        { name: 'code', type: T.String, required: false },
        { name: 'fichier', type: T.Attachment, required: false },
      ]);
    });
  });

  describe('admin commands', () => {
    it('/setup takes optional tableau and logs text channels', () => {
      const options = byName('setup').options as Option[];
      expect(shape(options)).toEqual([
        { name: 'tableau', type: T.Channel, required: false },
        { name: 'logs', type: T.Channel, required: false },
      ]);
      for (const o of options) expect(o.channel_types).toEqual([ChannelType.GuildText]);
    });

    it('/config takes annonce_niveau (1, 5, 10), morts (oui/non) and tri (niveau, temps, nom)', () => {
      expect(shape(byName('config').options as Option[])).toEqual([
        {
          name: 'annonce_niveau',
          type: T.Integer,
          required: false,
          choices: [
            ['chaque niveau', 1],
            ['tous les 5 niveaux', 5],
            ['tous les 10 niveaux', 10],
          ],
        },
        { name: 'morts', type: T.Boolean, required: false },
        {
          name: 'tri',
          type: T.String,
          required: false,
          choices: [
            ['niveau', 'level'],
            ['temps', 'played'],
            ['nom', 'name'],
          ],
        },
      ]);
    });

    it('/admin perso mirrors /perso ajouter for another member', () => {
      expect(shape(sub('admin', 'perso').options)).toEqual([
        { name: 'membre', type: T.User, required: true },
        { name: 'prenom', type: T.String, required: true },
        { name: 'nom', type: T.String, required: true },
        { name: 'region', type: T.String, required: false, choices: REGION_CHOICES },
        { name: 'role', type: T.String, required: false, choices: ROLE_CHOICES },
      ]);
    });

    it('/admin rafraichir and /admin suspects have no option', () => {
      expect(shape(sub('admin', 'rafraichir').options)).toEqual([]);
      expect(shape(sub('admin', 'suspects').options)).toEqual([]);
    });
  });
});
