/** HTTP client for the device API (docs/02 « Contrat d'échange »). Uses the global fetch of Node. */

export class ApiError extends Error {
  constructor({ status, code = null, message = '', retryAfterSec = null }) {
    super(`HTTP ${status}${code ? ` ${code}` : ''}${message ? ` : ${message}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function createApi({ baseUrl, token = null, fetch: doFetch = globalThis.fetch }) {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  async function post(path, body, { auth }) {
    if (auth && !token) throw new Error('aucun jeton : lance d’abord `pair <code>`');
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${token}`;
    const res = await doFetch(new URL(path, root), { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    const json = parseJson(text);
    if (!res.ok) {
      const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      throw new ApiError({
        status: res.status,
        code: json?.error?.code ?? null,
        message: json?.error?.message ?? '',
        retryAfterSec: Number.isFinite(retryAfter) ? retryAfter : null,
      });
    }
    return json;
  }

  return {
    pair: (body) => post('v1/devices/pair', body, { auth: false }),
    heartbeat: (body) => post('v1/heartbeat', body, { auth: true }),
    sync: (body) => post('v1/sync', body, { auth: true }),
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
