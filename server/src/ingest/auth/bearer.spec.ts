import { parseBearerToken } from './bearer';

const TOKEN = 'a'.repeat(21) + '_-' + 'Z9'.repeat(10);

describe('parseBearerToken', () => {
  it('extracts a 43-character base64url token', () => {
    expect(TOKEN).toHaveLength(43);
    expect(parseBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
  });

  it('accepts the scheme in any case (RFC 9110)', () => {
    expect(parseBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`BEARER ${TOKEN}`)).toBe(TOKEN);
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['other scheme', `Basic ${TOKEN}`],
    ['no token', 'Bearer '],
    ['token too short', `Bearer ${TOKEN.slice(1)}`],
    ['token too long', `Bearer ${TOKEN}A`],
    ['padding', `Bearer ${TOKEN.slice(1)}=`],
    ['standard base64 characters', `Bearer ${TOKEN.slice(2)}+/`],
    ['extra part', `Bearer ${TOKEN} extra`],
    ['several headers', [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]],
  ])('returns null for %s', (_label, header) => {
    expect(parseBearerToken(header)).toBeNull();
  });
});
