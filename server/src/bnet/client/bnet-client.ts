import type { Region } from '../../common/config/config';
import {
  BnetAuthError,
  BnetHttpError,
  BnetNotFoundError,
  BnetRateLimitedError,
  BnetUnauthorizedError,
} from './bnet-errors';
import type {
  BnetAccountProfile,
  BnetPublicCharacterResult,
  BnetRealm,
} from './bnet-types';
import { type Clock, systemClock } from './clock';
import { RateLimiter } from './rate-limiter';

/**
 * Isolated client for the Blizzard Forever API (docs/02 « Liaison Battle.net », docs/00 « Sources
 * de données »). The API is not documented by Blizzard: only the routes, namespaces and fields
 * cited in those docs are used. Every API call goes through one rate-limited queue.
 */

export const BNET_TOKEN_URL = 'https://oauth.battle.net/token';
export const BNET_LOCALE = 'fr_FR';

export type BnetNamespaceKind = 'dynamic' | 'static' | 'profile';

export function bnetNamespace(kind: BnetNamespaceKind, region: Region): string {
  return `${kind}-forever-${region}`;
}

export function bnetApiBaseUrl(region: Region): string {
  return `https://${region}.api.blizzard.com`;
}

export interface BnetCredentials {
  clientId: string;
  clientSecret: string;
}

const REALM_CACHE_MS = 24 * 3_600_000;
/** The app token is renewed this long before it expires (or at half-life if it is shorter). */
const TOKEN_RENEW_MARGIN_MS = 5 * 60_000;
const MAX_429_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 1000;

type Auth = { kind: 'app' } | { kind: 'user'; token: string };

interface ApiRequest {
  region: Region;
  path: string;
  query: Record<string, string>;
  auth: Auth;
  headers?: Record<string, string>;
}

interface CachedToken {
  token: string;
  renewAt: number;
}

export class BnetClient {
  private appTokenCache?: CachedToken;
  private appTokenInFlight?: Promise<string>;
  private readonly realms = new Map<string, { realm: BnetRealm; expiresAt: number }>();

  constructor(
    private readonly credentials: BnetCredentials,
    private readonly clock: Clock = systemClock,
    private readonly limiter: RateLimiter = new RateLimiter(clock),
  ) {}

  /** Characters of the account behind a player token. A 404 means no Forever character yet. */
  async getAccountProfile(region: Region, userToken: string): Promise<BnetAccountProfile> {
    const request: ApiRequest = {
      region,
      path: '/profile/user/wow',
      query: { namespace: bnetNamespace('profile', region), locale: BNET_LOCALE },
      auth: { kind: 'user', token: userToken },
    };
    const res = await this.send(request);
    if (res.status !== 200) throw await failure(res, request);

    const body = await readJson(res, request);
    if (!isRecord(body) || !Array.isArray(body.wow_accounts)) {
      throw new BnetHttpError(`${label(request)}: malformed account profile`, res.status);
    }
    return body as unknown as BnetAccountProfile;
  }

  /** Realm and its ruleset (`type.type`), cached 24 h per region. */
  async getRealm(region: Region, realmId: number): Promise<BnetRealm> {
    const key = `${region}:${realmId}`;
    const cached = this.realms.get(key);
    if (cached && this.clock.now() < cached.expiresAt) return cached.realm;

    const request: ApiRequest = {
      region,
      path: `/data/wow/realm/${realmId}`,
      query: { namespace: bnetNamespace('dynamic', region) },
      auth: { kind: 'app' },
    };
    const res = await this.send(request);
    if (res.status !== 200) throw await failure(res, request);

    const body = await readJson(res, request);
    const ruleset = isRecord(body) && isRecord(body.type) ? body.type.type : undefined;
    if (!isRecord(body) || typeof body.id !== 'number' || typeof ruleset !== 'string') {
      throw new BnetHttpError(`${label(request)}: malformed realm`, res.status);
    }
    const realm: BnetRealm = {
      id: body.id,
      name: typeof body.name === 'string' ? body.name : '',
      slug: typeof body.slug === 'string' ? body.slug : '',
      ruleset,
    };
    this.realms.set(key, { realm, expiresAt: this.clock.now() + REALM_CACHE_MS });
    return realm;
  }

  /**
   * Public character profile, `{first}-{surname}` in lowercase. Pass the last `Last-Modified`
   * received as `ifModifiedSince`: a 304 costs nothing.
   */
  async getPublicCharacter(
    region: Region,
    firstName: string,
    surname: string,
    ifModifiedSince?: string,
  ): Promise<BnetPublicCharacterResult> {
    const slug = encodeURIComponent(`${firstName}-${surname}`.toLowerCase());
    const request: ApiRequest = {
      region,
      path: `/profile/wow/character/${slug}`,
      query: { namespace: bnetNamespace('profile', region) },
      auth: { kind: 'app' },
      headers: ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince } : undefined,
    };
    const res = await this.send(request);

    if (res.status === 304 || res.status === 404) {
      await discard(res);
      return { status: res.status };
    }
    if (res.status !== 200) throw await failure(res, request);

    const body = await readJson(res, request);
    if (!isRecord(body)) throw new BnetHttpError(`${label(request)}: malformed character`, res.status);
    const lastModified = res.headers.get('last-modified') ?? undefined;
    return { status: 200, character: body, lastModified };
  }

  /** Queues the call, retries 429s after `Retry-After`, renews a rejected app token once. */
  private async send(request: ApiRequest): Promise<Response> {
    const url = new URL(request.path, bnetApiBaseUrl(request.region));
    for (const [name, value] of Object.entries(request.query)) url.searchParams.set(name, value);

    let retries429 = 0;
    let renewedAppToken = false;
    for (;;) {
      const token = request.auth.kind === 'user' ? request.auth.token : await this.appToken();
      await this.limiter.acquire();

      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...request.headers },
        });
      } catch {
        throw new BnetHttpError(`${label(request)}: network error`);
      }

      if (res.status === 429) {
        await discard(res);
        if (retries429 >= MAX_429_RETRIES) {
          throw new BnetRateLimitedError(`${label(request)}: still rate limited after ${retries429} retries`, 429);
        }
        retries429++;
        this.limiter.pauseUntil(this.clock.now() + retryAfterMs(res));
        continue;
      }
      if (res.status === 401 && request.auth.kind === 'app' && !renewedAppToken) {
        await discard(res);
        renewedAppToken = true;
        this.forgetAppToken(token);
        continue;
      }
      return res;
    }
  }

  private appToken(): Promise<string> {
    const cached = this.appTokenCache;
    if (cached && this.clock.now() < cached.renewAt) return Promise.resolve(cached.token);

    this.appTokenInFlight ??= this.requestAppToken().finally(() => {
      this.appTokenInFlight = undefined;
    });
    return this.appTokenInFlight;
  }

  private forgetAppToken(token: string): void {
    if (this.appTokenCache?.token === token) this.appTokenCache = undefined;
  }

  /** Client credentials grant. */
  private async requestAppToken(): Promise<string> {
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(BNET_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
      });
    } catch {
      throw new BnetAuthError('POST /token: network error');
    }
    if (res.status !== 200) {
      await discard(res);
      throw new BnetAuthError(`POST /token: HTTP ${res.status}`, res.status);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new BnetAuthError('POST /token: invalid JSON', res.status);
    }
    if (!isRecord(body) || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new BnetAuthError('POST /token: malformed response', res.status);
    }

    const lifetimeMs = body.expires_in * 1000;
    const margin = Math.min(TOKEN_RENEW_MARGIN_MS, lifetimeMs / 2);
    this.appTokenCache = { token: body.access_token, renewAt: this.clock.now() + lifetimeMs - margin };
    return body.access_token;
  }
}

function label(request: ApiRequest): string {
  return `GET ${request.path} (${request.region})`;
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

async function failure(res: Response, request: ApiRequest): Promise<Error> {
  await discard(res);
  const message = `${label(request)}: HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return new BnetUnauthorizedError(message, res.status);
  if (res.status === 404) return new BnetNotFoundError(message, res.status);
  return new BnetHttpError(message, res.status);
}

async function readJson(res: Response, request: ApiRequest): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new BnetHttpError(`${label(request)}: invalid JSON`, res.status);
  }
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
