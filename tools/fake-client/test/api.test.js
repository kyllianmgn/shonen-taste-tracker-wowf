import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { ApiError, createApi } from '../src/api.js';

let server;
let baseUrl;
const requests = [];
let reply = () => ({ status: 200, body: {} });

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const { status, body, headers = {} } = reply();
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(() => server.close());

describe('createApi', () => {
  it('pairs with POST /v1/devices/pair and returns the response body', async () => {
    reply = () => ({ status: 201, body: { deviceId: 'd', deviceToken: 't', heartbeatIntervalSec: 600 } });
    const api = createApi({ baseUrl });

    const out = await api.pair({ code: 'ABCDEFGH', deviceName: 'x', appVersion: '0.1.0', os: 'windows' });

    assert.deepEqual(out, { deviceId: 'd', deviceToken: 't', heartbeatIntervalSec: 600 });
    const last = requests.at(-1);
    assert.equal(last.method, 'POST');
    assert.equal(last.url, '/v1/devices/pair');
    assert.equal(last.headers.authorization, undefined);
    assert.equal(last.body.code, 'ABCDEFGH');
  });

  it('sends the device token as a Bearer on heartbeat and sync', async () => {
    reply = () => ({ status: 200, body: { ok: 1 } });
    const api = createApi({ baseUrl, token: 'tok' });

    await api.heartbeat({ sentAt: 1 });
    assert.equal(requests.at(-1).url, '/v1/heartbeat');
    assert.equal(requests.at(-1).headers.authorization, 'Bearer tok');

    await api.sync({ sentAt: 2 });
    assert.equal(requests.at(-1).url, '/v1/sync');
    assert.deepEqual(requests.at(-1).body, { sentAt: 2 });
  });

  it('throws an ApiError with the contract error code, the status and Retry-After', async () => {
    reply = () => ({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Trop de requêtes' } },
      headers: { 'retry-after': '42' },
    });
    const api = createApi({ baseUrl, token: 'tok' });

    await assert.rejects(api.sync({}), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, 'rate_limited');
      assert.equal(error.retryAfterSec, 42);
      assert.match(error.message, /429.*rate_limited.*Trop de requêtes/);
      return true;
    });
  });

  it('throws an ApiError even when the error body is not JSON', async () => {
    reply = () => ({ status: 502, body: undefined });
    const api = createApi({ baseUrl, token: 'tok' });

    await assert.rejects(api.heartbeat({}), (error) => error instanceof ApiError && error.status === 502);
  });

  it('refuses heartbeat and sync without a token', async () => {
    const api = createApi({ baseUrl });

    await assert.rejects(api.heartbeat({}), /pair/);
  });
});
