import { characterChoices, characterLabel, resolveCharacterPick } from './character-pick';
import type { OwnedCharacter } from './character.types';

const own = (id: bigint, firstName: string, surname: string, role: OwnedCharacter['role'], region = 'eu'): OwnedCharacter => ({
  id,
  region,
  firstName,
  surname,
  role,
  bnetVerified: false,
  lastSyncAt: null,
});

const DAVINA = own(1n, 'Davina', 'Asaria', 'main');
const BOREK = own(2n, 'Borek', 'Tanu', 'alt');
const OLDIE = own(3n, 'Oldie', 'Tanu', 'untracked', 'us');
const MINE = [DAVINA, BOREK, OLDIE];

describe('characterLabel', () => {
  it('shows names, region and role in French', () => {
    expect(characterLabel(DAVINA)).toBe('Davina Asaria (EU) · principal');
    expect(characterLabel(BOREK)).toBe('Borek Tanu (EU) · secondaire');
    expect(characterLabel(OLDIE)).toBe('Oldie Tanu (US) · non suivi');
  });
});

describe('characterChoices (autocomplete)', () => {
  it('offers every character but the main for /perso principal', () => {
    expect(characterChoices(MINE, 'principal', '')).toEqual([
      { name: 'Borek Tanu (EU) · secondaire', value: '2' },
      { name: 'Oldie Tanu (US) · non suivi', value: '3' },
    ]);
  });

  it('offers only tracked characters for /perso retirer', () => {
    expect(characterChoices(MINE, 'retirer', '').map((c) => c.value)).toEqual(['1', '2']);
  });

  it('filters on what the member typed, ignoring case and accents', () => {
    expect(characterChoices(MINE, 'retirer', 'TAN').map((c) => c.value)).toEqual(['2']);
    expect(characterChoices([own(4n, 'Éloïse', 'Vane', 'alt')], 'retirer', 'elois').map((c) => c.value)).toEqual(['4']);
  });

  it('never offers more than 25 choices', () => {
    const many = Array.from({ length: 30 }, (_, i) => own(BigInt(i + 10), 'Perso', `Num${i}`, 'untracked'));
    expect(characterChoices(many, 'principal', '')).toHaveLength(25);
  });
});

describe('resolveCharacterPick', () => {
  it('resolves the id sent by the autocomplete', () => {
    expect(resolveCharacterPick('2', MINE)).toBe(BOREK);
  });

  it('refuses an id that is not one of the member’s characters', () => {
    expect(resolveCharacterPick('99', MINE)).toBeNull();
  });

  it('resolves typed names, ignoring case and extra spaces', () => {
    expect(resolveCharacterPick('  davina   ASARIA ', MINE)).toBe(DAVINA);
  });

  it('resolves the full autocomplete label', () => {
    expect(resolveCharacterPick('Borek Tanu (EU) · secondaire', MINE)).toBe(BOREK);
  });

  it('refuses an unknown or ambiguous name', () => {
    expect(resolveCharacterPick('Nobody Here', MINE)).toBeNull();
    const twins = [own(5n, 'Twin', 'Same', 'main', 'eu'), own(6n, 'Twin', 'Same', 'alt', 'us')];
    expect(resolveCharacterPick('Twin Same', twins)).toBeNull();
    expect(resolveCharacterPick('Twin Same (US)', twins)).toBe(twins[1]);
  });
});
