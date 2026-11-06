import { createHash, randomBytes, randomInt as cryptoRandomInt } from 'node:crypto';

/**
 * Secrets of the pairing flow (docs/02 « Appairage »). Only their SHA-256 is ever stored (CLAUDE.md
 * hard rules); the plain values exist once, in the /lier appli reply and in the pair response.
 */

/** 8 characters without ambiguity: no 0/O, no 1/I. Same set as `pair.request.json`. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Device tokens: 32 random bytes in base64url, i.e. 43 characters without padding. */
const DEVICE_TOKEN_BYTES = 32;

/** `randomInt(max)` returns an integer in [0, max); crypto-grade and unbiased by default. */
export function generatePairingCode(randomInt: (max: number) => number = cryptoRandomInt): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  return code;
}

export function generateDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
