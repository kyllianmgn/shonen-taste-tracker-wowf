import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The device token from `pair`, in a gitignored file. Never printed. */
export function readToken(file) {
  if (!existsSync(file)) return null;
  const token = readFileSync(file, 'utf8').trim();
  return token || null;
}

export function writeToken(file, token) {
  writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}
