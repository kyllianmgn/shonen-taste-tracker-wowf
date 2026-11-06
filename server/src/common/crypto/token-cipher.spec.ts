import { randomBytes } from 'node:crypto';
import { decryptToken, encryptToken, TOKEN_NONCE_BYTES, TOKEN_TAG_BYTES } from './token-cipher';

const KEY = Buffer.alloc(32, 7);

describe('token cipher (AES-256-GCM)', () => {
  it('decrypts what it encrypted', () => {
    const sealed = encryptToken(KEY, 'test-user-token');
    expect(decryptToken(KEY, sealed)).toBe('test-user-token');
  });

  it('never stores the token in clear and prefixes a nonce and a tag', () => {
    const sealed = encryptToken(KEY, 'test-user-token');
    expect(sealed.includes(Buffer.from('test-user-token'))).toBe(false);
    expect(sealed.length).toBe(TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES + 'test-user-token'.length);
  });

  it('draws a fresh random nonce for every encryption', () => {
    const a = encryptToken(KEY, 'same');
    const b = encryptToken(KEY, 'same');
    expect(a.subarray(0, TOKEN_NONCE_BYTES).equals(b.subarray(0, TOKEN_NONCE_BYTES))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('refuses a tampered ciphertext', () => {
    const sealed = encryptToken(KEY, 'test-user-token');
    sealed[sealed.length - 1] ^= 0x01;
    expect(() => decryptToken(KEY, sealed)).toThrow();
  });

  it('refuses another key', () => {
    const sealed = encryptToken(KEY, 'test-user-token');
    expect(() => decryptToken(randomBytes(32), sealed)).toThrow();
  });

  it('refuses a truncated blob and a key that is not 32 bytes', () => {
    expect(() => decryptToken(KEY, Buffer.alloc(TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES - 1))).toThrow();
    expect(() => encryptToken(Buffer.alloc(16), 'x')).toThrow('32 bytes');
  });
});
