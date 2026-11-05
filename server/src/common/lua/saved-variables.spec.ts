import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LuaParseError } from './lua-parser';
import { JsonSchema } from './normalize';
import { parseSavedVariables } from './saved-variables';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const fixturesDir = join(repoRoot, 'contract', 'fixtures', 'savedvariables');
const syncRequestSchema = JSON.parse(
  readFileSync(join(repoRoot, 'contract', 'schemas', 'sync.request.json'), 'utf8'),
) as JsonSchema;

function fixture(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

type Character = {
  key: Record<string, unknown>;
  snapshot: Record<string, unknown> & {
    equipment: { link: string }[];
  };
  events: { data: Record<string, unknown> }[];
};

describe('parseSavedVariables (contract fixtures)', () => {
  describe('ForeverTracker.sample.lua', () => {
    const result = parseSavedVariables(fixture('ForeverTracker.sample.lua'), syncRequestSchema);
    const characters = result!.characters as Character[];

    it('reads the header and 2 characters in file order', () => {
      expect(result!.schema).toBe(1);
      expect(result!.addonVersion).toBe('0.1.0');
      expect(characters.map((c) => c.key.firstName)).toEqual(['Davina', 'Morwen']);
    });

    it('decodes the spec example exactly', () => {
      expect(characters[0]).toEqual({
        key: {
          region: 'eu',
          firstName: 'Davina',
          surname: 'Asaria',
          guid: 'Player-4242-0A1B2C3D',
          realmName: 'CAMWOW EU5 Realm 1 PvE',
        },
        snapshot: {
          capturedAt: 1793900000,
          level: 23,
          xp: 4120,
          xpMax: 13600,
          rested: 2100,
          money: 384512,
          playedTotal: 81234,
          playedLevel: 2310,
          zone: 'Duskwood',
          subZone: 'Darkshire',
          mapId: 1431,
          classFile: 'PRIEST',
          raceFile: 'Troll',
          sex: 3,
          faction: 'Horde',
          guild: 'Les Veilleurs',
          guildRank: 'Membre',
          ilvl: 21,
          deaths: 4,
          honor: 0,
          equipment: [{ slot: 1, itemId: 7720, link: '|cff1eff00|Hitem:7720::...|h[...]|h|r' }],
          professions: [{ name: 'Herboristerie', rank: 112, max: 150 }],
          reputations: [{ factionId: 76, name: 'Orgrimmar', standing: 5, value: 1200, max: 6000 }],
        },
        events: [
          {
            id: 'Player-4242-0A1B2C3D-1793899000-1',
            type: 'SESSION_START',
            at: 1793899000,
            data: { level: 22, zone: 'Duskwood' },
          },
          {
            id: 'Player-4242-0A1B2C3D-1793899800-2',
            type: 'LEVEL_UP',
            at: 1793899800,
            data: { level: 23, playedTotal: 80900, zone: 'Duskwood' },
          },
        ],
      });
    });

    it('normalizes the empty tables of the 2nd character to []', () => {
      const morwen = characters[1];
      expect(morwen.snapshot.equipment).toEqual([]);
      expect(morwen.snapshot.professions).toEqual([]);
      expect(morwen.snapshot.reputations).toEqual([]);
      expect(morwen.events).toEqual([]);
    });
  });

  describe('ForeverTracker.empty.lua', () => {
    it('returns null without error: nothing to send', () => {
      expect(parseSavedVariables(fixture('ForeverTracker.empty.lua'), syncRequestSchema)).toBeNull();
    });
  });

  describe('ForeverTracker.malicious.lua', () => {
    it('is rejected as a non-literal expression at the first offending value', () => {
      let error: unknown;
      try {
        parseSavedVariables(fixture('ForeverTracker.malicious.lua'), syncRequestSchema);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(LuaParseError);
      const err = error as LuaParseError;
      expect(err.code).toBe('NonLiteralExpression');
      // `os.execute("calc")` in the settings table.
      expect(err.line).toBe(6);
      expect(err.column).toBe(75);
      expect(err.message).toContain('expression non littérale');
    });

    it('also rejects the concatenation and the global once the call is gone', () => {
      const src = fixture('ForeverTracker.malicious.lua').toString('utf8');
      const withoutCall = src.replace('os.execute("calc")', 'false');
      const concat = catchParse(withoutCall);
      expect([concat.code, concat.line, concat.column]).toEqual(['NonLiteralExpression', 9, 84]);

      const withoutConcat = withoutCall.replace('"Asa" .. "ria"', '"Asaria"');
      const global = catchParse(withoutConcat);
      expect([global.code, global.line, global.column]).toEqual(['NonLiteralExpression', 10, 70]);
    });
  });

  describe('ForeverTracker.escapes.lua', () => {
    const result = parseSavedVariables(fixture('ForeverTracker.escapes.lua'), syncRequestSchema);
    const [character] = result!.characters as Character[];
    const { snapshot, events } = character;

    it('decodes the documented values', () => {
      expect(result!.characters).toHaveLength(1);
      expect(character.key.realmName).toBe('CAMWOW EU5 Realm 1 PvE');
      expect(snapshot.guild).toBe('Les "Veilleurs"');
      expect(snapshot.guildRank).toBe("L'Officier");
      expect(snapshot.zone).toBe('Bois de la Pénombre');
      expect(snapshot.subZone).toBe('Line one\nLine two\tTabbed\\Backslash');
      expect(snapshot.ilvl).toBe(21.5);
      expect(snapshot.equipment[0].link).toBe(
        "|cff1eff00|Hitem:7720::::::::23:::::::::|h[Whitemane's Chapeau]|h|r",
      );
      expect(snapshot.equipment[1].link).toBe('|cffffffff|Hitem:6060::::::::23:::::::::|h[Flax Vest]|h|r');
      expect(snapshot.professions).toEqual([]);
      expect(snapshot.reputations).toEqual([]);
      expect(events[0].data).toEqual({});
      expect(Array.isArray(events[0].data)).toBe(false);
      expect(events[1].data.from).toBe('Ancienne -- pas un commentaire');
      expect(events[1].data.to).toBe('Les "Veilleurs" ]] encore');
    });
  });

  it('covers every SavedVariables fixture', () => {
    expect(readdirSync(fixturesDir).sort()).toEqual([
      'ForeverTracker.empty.lua',
      'ForeverTracker.escapes.lua',
      'ForeverTracker.malicious.lua',
      'ForeverTracker.sample.lua',
    ]);
  });
});

describe('parseSavedVariables (structure)', () => {
  it('returns no characters when ForeverTrackerDB has none', () => {
    expect(parseSavedVariables('ForeverTrackerDB = { schema = 1 }', syncRequestSchema)).toEqual({
      schema: 1,
      addonVersion: undefined,
      characters: [],
    });
  });

  it('returns null when ForeverTrackerDB is not a table', () => {
    expect(parseSavedVariables('ForeverTrackerDB = 5', syncRequestSchema)).toBeNull();
  });
});

describe('lua module sources', () => {
  it('never evaluate code (no eval, Function, vm or Lua engine)', () => {
    const forbidden = [/\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /['"](node:)?vm['"]/, /fengari|wasmoon/i];
    const sources = readdirSync(__dirname).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(join(__dirname, file), 'utf8');
      for (const pattern of forbidden) expect({ file, match: pattern.test(text) }).toEqual({ file, match: false });
    }
  });
});

function catchParse(src: string): LuaParseError {
  try {
    parseSavedVariables(src, syncRequestSchema);
  } catch (e) {
    if (e instanceof LuaParseError) return e;
    throw e;
  }
  throw new Error('expected a LuaParseError');
}
