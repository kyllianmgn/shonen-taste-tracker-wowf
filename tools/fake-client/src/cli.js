import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ApiError } from './api.js';
import { describeSync, parseScenario, runScenario } from './scenario.js';
import { retime } from './time.js';

export const USAGE = `Usage : node tools/fake-client <commande>
  pair <code>                               appaire ce faux client (code de /lier appli)
  heartbeat --running|--stopped [--fixture <fichier>] [--offset-sec <n>]
  sync --fixture <fichier> [--offset-sec <n>]
  scenario <fichier>                        rejoue une liste d'étapes
Variables : API_BASE_URL (défaut http://localhost:3000), FAKE_CLIENT_TOKEN_FILE (défaut tools/fake-client/.token)`;

const DEFAULT_BASE_URL = 'http://localhost:3000';
const APP_VERSION = '0.1.0';

class UsageError extends Error {}

/**
 * Entry point, with every side effect injected (see index.js for the real ones).
 * deps: { env, tokenFile, defaultFixturesDir, cwd, createApi, readToken, writeToken, loadJson,
 *         nowSec, sleep, out, err }
 * Returns the exit code: 0 ok, 1 failure, 2 bad usage.
 */
export async function main(argv, deps) {
  try {
    const [command, ...rest] = argv[0]?.startsWith('--fixture') ? ['sync', ...argv] : argv;
    switch (command) {
      case 'pair':
        return await pair(rest, deps);
      case 'heartbeat':
        return await heartbeat(rest, deps);
      case 'sync':
        return await sync(rest, deps);
      case 'scenario':
        return await scenario(rest, deps);
      case undefined:
      case 'help':
      case '--help':
        deps.out(USAGE);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`commande inconnue : ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      deps.err(`${error.message}\n${USAGE}`);
      return 2;
    }
    deps.err(`Échec : ${error instanceof ApiError || error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parse(args, options, allowPositionals = false) {
  // `--offset-sec -30`: parseArgs would read the negative number as an option.
  const joined = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offset-sec' && i + 1 < args.length) joined.push(`--offset-sec=${args[++i]}`);
    else joined.push(args[i]);
  }
  try {
    return parseArgs({ args: joined, options, allowPositionals, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
}

function offsetOf(values) {
  if (values['offset-sec'] === undefined) return 0;
  const offset = Number(values['offset-sec']);
  if (!Number.isInteger(offset)) throw new UsageError('--offset-sec doit être un entier');
  return offset;
}

function apiOf(deps, { auth = true } = {}) {
  const baseUrl = deps.env.API_BASE_URL || DEFAULT_BASE_URL;
  const token = auth ? deps.readToken(deps.tokenFile) : null;
  if (auth && !token) throw new Error('aucun jeton : lance d’abord `node tools/fake-client pair <code>`');
  return deps.createApi({ baseUrl, token });
}

async function pair(args, deps) {
  const { positionals } = parse(args, {}, true);
  if (positionals.length !== 1) throw new UsageError('pair demande un code');
  const code = positionals[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  const res = await apiOf(deps, { auth: false }).pair({ code, deviceName: 'fake-client', appVersion: APP_VERSION, os: 'windows' });
  deps.writeToken(deps.tokenFile, res.deviceToken);
  deps.out(`Appairé : appareil ${res.deviceId}, heartbeat toutes les ${res.heartbeatIntervalSec} s. Jeton enregistré.`);
  return 0;
}

async function heartbeat(args, deps) {
  const { values } = parse(args, {
    running: { type: 'boolean' },
    stopped: { type: 'boolean' },
    fixture: { type: 'string' },
    'offset-sec': { type: 'string' },
  });
  if (Boolean(values.running) === Boolean(values.stopped)) throw new UsageError('heartbeat demande --running ou --stopped');
  const offsetSec = offsetOf(values);
  const api = apiOf(deps);
  const file = values.fixture
    ? resolve(deps.cwd, values.fixture)
    : resolve(deps.defaultFixturesDir, values.running ? 'heartbeat.running.json' : 'heartbeat.stopped.json');
  const body = retime(deps.loadJson(file), { nowSec: deps.nowSec(), offsetSec });
  body.gameRunning = Boolean(values.running);
  const res = await api.heartbeat(body);
  deps.out(`heartbeat ${values.running ? 'jeu lancé' : 'jeu arrêté'} : ok (intervalle ${res.heartbeatIntervalSec} s)`);
  return 0;
}

async function sync(args, deps) {
  const { values } = parse(args, { fixture: { type: 'string' }, 'offset-sec': { type: 'string' } });
  if (!values.fixture) throw new UsageError('sync demande --fixture <fichier>');
  const offsetSec = offsetOf(values);
  const api = apiOf(deps);
  const body = retime(deps.loadJson(resolve(deps.cwd, values.fixture)), { nowSec: deps.nowSec(), offsetSec });
  const res = await api.sync(body);
  deps.out(`sync : ${describeSync(res)}`);
  return 0;
}

async function scenario(args, deps) {
  const { positionals } = parse(args, {}, true);
  if (positionals.length !== 1) throw new UsageError('scenario demande un fichier');
  const file = resolve(deps.cwd, positionals[0]);
  const steps = parseScenario(deps.loadJson(file));
  await runScenario(steps, {
    api: apiOf(deps),
    baseDir: dirname(file),
    loadJson: deps.loadJson,
    nowSec: deps.nowSec,
    sleep: deps.sleep,
    log: deps.out,
  });
  deps.out('Scénario terminé.');
  return 0;
}
