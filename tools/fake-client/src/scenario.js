import { resolve } from 'node:path';
import { ApiError } from './api.js';
import { retime } from './time.js';

/**
 * A scenario is a JSON list of steps `{ action, fixture?, gameRunning?, waitSec?, offsetSec? }`:
 * - `heartbeat`: POST /v1/heartbeat, body from `fixture` or built from `gameRunning` (which also
 *   overrides the fixture's value);
 * - `sync`: POST /v1/sync with `fixture`;
 * - `wait`: only waits.
 * Fixture paths are relative to the scenario file. Every payload is retimed when sent (see
 * time.js, `offsetSec` defaults to 0). `waitSec` is the pause after the step.
 */
const ACTIONS = ['heartbeat', 'sync', 'wait'];
const FIELDS = ['action', 'fixture', 'gameRunning', 'waitSec', 'offsetSec'];
const APP_VERSION = '0.1.0';

export function parseScenario(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('un scénario est une liste d’étapes non vide');
  return raw.map((step, i) => {
    const fail = (message) => {
      throw new Error(`étape ${i + 1} : ${message}`);
    };
    if (typeof step !== 'object' || step === null || Array.isArray(step)) fail('doit être un objet');
    const unknown = Object.keys(step).filter((k) => !FIELDS.includes(k));
    if (unknown.length) fail(`champ inconnu ${unknown.join(', ')}`);
    if (!ACTIONS.includes(step.action)) fail(`action doit valoir ${ACTIONS.join(', ')}`);
    if (step.fixture !== undefined && (typeof step.fixture !== 'string' || !step.fixture)) fail('fixture doit être un chemin');
    if (step.gameRunning !== undefined && typeof step.gameRunning !== 'boolean') fail('gameRunning doit être un booléen');
    if (step.waitSec !== undefined && !(Number.isFinite(step.waitSec) && step.waitSec >= 0)) fail('waitSec doit être un nombre >= 0');
    if (step.offsetSec !== undefined && !Number.isInteger(step.offsetSec)) fail('offsetSec doit être un entier');
    if (step.action === 'sync' && !step.fixture) fail('sync demande une fixture');
    if (step.action === 'heartbeat' && step.fixture === undefined && step.gameRunning === undefined) {
      fail('heartbeat demande gameRunning ou une fixture');
    }
    if (step.action === 'wait' && step.waitSec === undefined) fail('wait demande waitSec');
    return { ...step };
  });
}

/**
 * Runs parsed steps one by one. A 429 is retried once after its Retry-After; any other error stops
 * the scenario.
 * deps: { api, baseDir, loadJson(path), nowSec(), sleep(ms), log(line) }
 */
export async function runScenario(steps, deps) {
  const { api, baseDir, loadJson, nowSec, sleep, log } = deps;
  for (const [i, step] of steps.entries()) {
    const prefix = `${i + 1}/${steps.length} ${step.action}`;
    if (step.action !== 'wait') {
      const template = step.fixture ? loadJson(resolve(baseDir, step.fixture)) : null;
      const build = () => buildBody(step, template, nowSec());
      const send = step.action === 'heartbeat' ? api.heartbeat : api.sync;
      const response = await withRetry(() => send(build()), sleep);
      log(`${prefix} : ${describe(step, response)}`);
    } else {
      log(`${prefix} : ${step.waitSec} s`);
    }
    if (step.waitSec) await sleep(step.waitSec * 1000);
  }
}

function buildBody(step, template, now) {
  const base = template ?? { sentAt: now, gameRunning: step.gameRunning, appVersion: APP_VERSION };
  const body = retime(base, { nowSec: now, offsetSec: step.offsetSec ?? 0 });
  if (step.action === 'heartbeat' && step.gameRunning !== undefined) body.gameRunning = step.gameRunning;
  return body;
}

async function withRetry(call, sleep) {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 429) throw error;
    await sleep((error.retryAfterSec ?? 60) * 1000);
    return call();
  }
}

/** One line on what the server answered. */
export function describe(step, response) {
  if (step.action === 'heartbeat') {
    const sent = step.gameRunning ?? true;
    return `${sent ? 'jeu lancé' : 'jeu arrêté'} (intervalle ${response?.heartbeatIntervalSec ?? '?'} s)`;
  }
  return describeSync(response);
}

export function describeSync(response) {
  const results = response?.results ?? [];
  if (!results.length) return 'aucun résultat';
  return results
    .map((r) => {
      const flags = r.flags?.length ? `, flags ${r.flags.join(', ')}` : '';
      return `${r.status} (${r.acceptedEvents ?? 0} événement(s) accepté(s), ${r.duplicateEvents ?? 0} doublon(s)${flags})`;
    })
    .join(' ; ');
}
