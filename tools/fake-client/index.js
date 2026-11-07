#!/usr/bin/env node
// Fake companion app: replays contract fixtures and scenarios against the server (docs/03 « Faux client »).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/api.js';
import { main } from './src/cli.js';
import { readToken, writeToken } from './src/token-store.js';

const here = dirname(fileURLToPath(import.meta.url));

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  tokenFile: process.env.FAKE_CLIENT_TOKEN_FILE || join(here, '.token'),
  defaultFixturesDir: resolve(here, '../../contract/fixtures'),
  cwd: process.cwd(),
  createApi,
  readToken,
  writeToken,
  loadJson: (path) => JSON.parse(readFileSync(path, 'utf8')),
  nowSec: () => Math.floor(Date.now() / 1000),
  sleep: (ms) => sleep(ms),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
