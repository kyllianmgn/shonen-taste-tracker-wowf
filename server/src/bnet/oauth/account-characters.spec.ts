import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BnetAccountCharacter, BnetAccountProfile } from '../client';
import { accountCharacters, realmIdFromHref } from './account-characters';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'contract', 'fixtures', 'bnet');
const profileFixture = JSON.parse(readFileSync(join(FIXTURES, 'account-profile.json'), 'utf8')) as BnetAccountProfile;
const davina = profileFixture.wow_accounts[0].characters[0];

const character = (over: Partial<BnetAccountCharacter>): BnetAccountCharacter => ({ ...davina, ...over });
const profile = (...accounts: BnetAccountCharacter[][]): BnetAccountProfile => ({
  wow_accounts: accounts.map((characters, i) => ({ id: i + 1, characters })),
});

describe('accountCharacters', () => {
  it('reads names, level, class, race, faction and realm of the fixture', () => {
    expect(accountCharacters(profileFixture)).toEqual([
      {
        firstName: 'Davina',
        surname: 'Asaria',
        level: 23,
        classFile: 'PRIEST',
        raceFile: 'Troll',
        faction: 'Horde',
        realmId: 6855,
      },
    ]);
  });

  it('merges every wow account of the Battle.net account', () => {
    const other = character({ name: 'Kael', surname: 'Ombre', id: 2 });
    expect(accountCharacters(profile([davina], [other])).map((c) => c.firstName)).toEqual(['Davina', 'Kael']);
  });

  it('keeps one entry per name, case-insensitively, like the character identity', () => {
    const twin = character({ name: 'DAVINA', surname: 'asaria', level: 30 });
    expect(accountCharacters(profile([davina, twin]))).toHaveLength(1);
  });

  it('skips names that are not 2-12 letters', () => {
    const bad = character({ name: 'D4vina' });
    const empty = character({ name: 'Kael', surname: '' });
    expect(accountCharacters(profile([bad, empty, davina])).map((c) => c.firstName)).toEqual(['Davina']);
  });

  it.each([
    [1, 'WARRIOR'],
    [2, 'PALADIN'],
    [3, 'HUNTER'],
    [4, 'ROGUE'],
    [5, 'PRIEST'],
    [7, 'SHAMAN'],
    [8, 'MAGE'],
    [9, 'WARLOCK'],
    [11, 'DRUID'],
  ])('maps class id %i to %s', (id, file) => {
    expect(accountCharacters(profile([character({ playable_class: { id, name: '?' } })]))[0].classFile).toBe(file);
  });

  it.each([
    [1, 'Human'],
    [2, 'Orc'],
    [3, 'Dwarf'],
    [4, 'NightElf'],
    [5, 'Scourge'],
    [6, 'Tauren'],
    [7, 'Gnome'],
    [8, 'Troll'],
  ])('maps race id %i to %s', (id, file) => {
    expect(accountCharacters(profile([character({ playable_race: { id, name: '?' } })]))[0].raceFile).toBe(file);
  });

  it('leaves unknown class and race ids (e.g. Skyborne) null instead of guessing', () => {
    const [c] = accountCharacters(
      profile([character({ playable_class: { id: 99, name: '?' }, playable_race: { id: 99, name: '?' } })]),
    );
    expect(c).toMatchObject({ classFile: null, raceFile: null });
  });

  it('maps the faction type to the contract values', () => {
    const alliance = character({ faction: { type: 'ALLIANCE', name: 'Alliance' } });
    const odd = character({ name: 'Kael', faction: { type: 'NEUTRAL', name: 'Neutre' } });
    expect(accountCharacters(profile([alliance, odd])).map((c) => c.faction)).toEqual(['Alliance', 'Neutral']);
  });

  it('tolerates missing optional fields', () => {
    const bare = { name: 'Kael', surname: 'Ombre', id: 3 } as unknown as BnetAccountCharacter;
    expect(accountCharacters(profile([bare]))).toEqual([
      { firstName: 'Kael', surname: 'Ombre', level: null, classFile: null, raceFile: null, faction: null, realmId: null },
    ]);
  });
});

describe('realmIdFromHref', () => {
  it('reads the realm id of the protected character link', () => {
    expect(realmIdFromHref(davina.protected_character.href)).toBe(6855);
  });

  it.each([['https://eu.api.blizzard.com/profile/wow/character/davina-asaria'], [''], ['protected-character/x-1']])(
    'returns null for %p',
    (href) => {
      expect(realmIdFromHref(href)).toBeNull();
    },
  );
});
