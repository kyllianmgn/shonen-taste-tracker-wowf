import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM sealing of Battle.net player tokens kept in base mode (docs/02 « Mode de base »,
 * key TOKEN_ENC_KEY). Layout of a sealed blob: nonce (12 bytes) | auth tag (16 bytes) | ciphertext.
 * A fresh random nonce is drawn for every encryption.
 */

export const TOKEN_NONCE_BYTES = 12;
export const TOKEN_TAG_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = 'aes-256-gcm';

function checkKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error(`Token encryption key must be ${KEY_BYTES} bytes`);
}

/** Backed by a plain ArrayBuffer, as Prisma expects for a `Bytes` column. */
export function encryptToken(key: Buffer, token: string): Buffer<ArrayBuffer> {
  checkKey(key);
  const nonce = randomBytes(TOKEN_NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TOKEN_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const sealed = Buffer.alloc(TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES + ciphertext.length);
  nonce.copy(sealed, 0);
  cipher.getAuthTag().copy(sealed, TOKEN_NONCE_BYTES);
  ciphertext.copy(sealed, TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES);
  return sealed;
}

/** Throws on a wrong key, a truncated blob or any tampering (GCM authentication). */
export function decryptToken(key: Buffer, sealed: Buffer): string {
  checkKey(key);
  if (sealed.length < TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES) throw new Error('Sealed token is too short');
  const nonce = sealed.subarray(0, TOKEN_NONCE_BYTES);
  const tag = sealed.subarray(TOKEN_NONCE_BYTES, TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TOKEN_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(TOKEN_NONCE_BYTES + TOKEN_TAG_BYTES)), decipher.final()]).toString('utf8');
}
