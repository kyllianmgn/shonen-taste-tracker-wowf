import { normalizeCharacterName, parseRegion } from './character-name';

describe('normalizeCharacterName', () => {
  it.each([
    ['Davina', 'Davina'],
    ['davina', 'Davina'],
    ['DAVINA', 'Davina'],
    ['dAvInA', 'Davina'],
    ['  Asaria  ', 'Asaria'],
    ['éloïse', 'Éloïse'],
    ['ÉLOÏSE', 'Éloïse'],
    ['Al', 'Al'],
    ['Abcdefghijkl', 'Abcdefghijkl'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeCharacterName(raw)).toBe(expected);
  });

  it('composes decomposed accents (NFD → NFC) before counting and comparing', () => {
    const decomposed = 'éloïse';
    expect(normalizeCharacterName(decomposed)).toBe('Éloïse');
  });

  it.each([
    ['', 'empty'],
    ['A', 'too short'],
    ['Abcdefghijklm', 'too long (13)'],
    ['Da vina', 'inner space'],
    ['Davina2', 'digit'],
    ['Dav-ina', 'punctuation'],
    ['**Davina**', 'markdown'],
  ])('refuses %j (%s)', (raw) => {
    expect(normalizeCharacterName(raw)).toBeNull();
  });
});

describe('parseRegion', () => {
  it('defaults to EU', () => {
    expect(parseRegion(null)).toBe('eu');
    expect(parseRegion(undefined)).toBe('eu');
  });

  it.each(['eu', 'us', 'kr', 'tw', 'EU', 'Us'])('accepts %s', (raw) => {
    expect(parseRegion(raw)).toBe(raw.toLowerCase());
  });

  it('refuses an unknown region', () => {
    expect(parseRegion('cn')).toBeNull();
  });
});
