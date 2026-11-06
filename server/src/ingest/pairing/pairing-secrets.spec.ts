import { createHash } from 'node:crypto';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_PATTERN,
  generateDeviceToken,
  generatePairingCode,
  sha256Hex,
} from './pairing-secrets';

describe('pairing code', () => {
  it('uses the 32 unambiguous characters of the contract: no 0/O, no 1/I', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(32);
    for (const c of '01OI') expect(PAIRING_CODE_ALPHABET).not.toContain(c);
    for (const c of PAIRING_CODE_ALPHABET) expect(c).toMatch(/^[A-HJ-NP-Z2-9]$/);
  });

  it('matches the pattern of pair.request.json', () => {
    expect(PAIRING_CODE_PATTERN.source).toBe('^[A-HJ-NP-Z2-9]{8}$');
    for (let i = 0; i < 200; i++) expect(generatePairingCode()).toMatch(PAIRING_CODE_PATTERN);
  });

  it('draws each of the 8 characters uniformly from the alphabet', () => {
    const draws: number[] = [];
    const randomInt = (max: number) => {
      expect(max).toBe(32);
      draws.push(max);
      return (draws.length * 5) % 32;
    };

    const code = generatePairingCode(randomInt);

    expect(draws).toHaveLength(8);
    expect(code).toBe([5, 10, 15, 20, 25, 30, 3, 8].map((i) => PAIRING_CODE_ALPHABET[i]).join(''));
  });
});

describe('device token', () => {
  it('is 32 random bytes in base64url: 43 characters, no padding', () => {
    const token = generateDeviceToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('differs on every call', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateDeviceToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('sha256Hex', () => {
  it('returns the lowercase hex SHA-256 of the UTF-8 text', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('K7P29QXM')).toBe(createHash('sha256').update('K7P29QXM', 'utf8').digest('hex'));
  });
});
