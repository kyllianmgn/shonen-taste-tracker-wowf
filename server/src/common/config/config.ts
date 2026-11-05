/**
 * Startup configuration, read from environment variables only (docs/02 « Variables d'environnement »).
 * `loadConfig` is pure: it never reads `process.env` itself and never echoes values in errors,
 * so secrets cannot leak into logs.
 */

export const REGIONS = ['eu', 'us', 'kr', 'tw'] as const;
export type Region = (typeof REGIONS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'verbose'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  /** Dev only: register commands on this guild for instant updates. */
  discordDevGuildId: string | undefined;
  databaseUrl: string;
  /** Without trailing slash. */
  publicBaseUrl: string;
  bnetClientId: string;
  bnetClientSecret: string;
  bnetRedirectUri: string;
  bnetDefaultRegion: Region;
  bnetPublicProfile: boolean;
  heartbeatIntervalSec: number;
  levelCap: number;
  boardMinEditIntervalSec: number;
  appDownloadUrl: string;
  logLevel: LogLevel;
  /** AES-256-GCM key, exactly 32 bytes. */
  tokenEncKey: Buffer;
}

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration (${problems.length} problem${problems.length > 1 ? 's' : ''}):\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nSee server/.env.example for the expected variables.',
    );
    this.name = 'ConfigError';
  }
}

/** Minimum heartbeat interval: the API allows 2 heartbeats per minute per device. */
const MIN_HEARTBEAT_INTERVAL_SEC = 30;
/** Board edits are debounced to at least 15 s per guild (CLAUDE.md hard rules). */
const MIN_BOARD_EDIT_INTERVAL_SEC = 15;
const SNOWFLAKE = /^\d{17,20}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function loadConfig(env: Env): AppConfig {
  const problems: string[] = [];

  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  /** Reads a variable (or its fallback) and validates it, collecting problems instead of throwing. */
  const field = <T>(
    name: string,
    opts: { fallback?: string; optional?: boolean },
    parse: (raw: string) => { ok: true; value: T } | { ok: false; error: string },
  ): T | undefined => {
    const raw = read(name) ?? opts.fallback;
    if (raw === undefined) {
      if (!opts.optional) problems.push(`${name} is required`);
      return undefined;
    }
    const result = parse(raw);
    if (!result.ok) {
      problems.push(`${name} ${result.error}`);
      return undefined;
    }
    return result.value;
  };

  const ok = <T>(value: T) => ({ ok: true as const, value });
  const fail = (error: string) => ({ ok: false as const, error });

  const text = (raw: string) => ok(raw);
  const snowflake = (raw: string) =>
    SNOWFLAKE.test(raw) ? ok(raw) : fail('must be a Discord snowflake (17-20 digits)');
  const httpUrl = (raw: string) => {
    try {
      const url = new URL(raw);
      if (url.protocol === 'http:' || url.protocol === 'https:') return ok(raw.replace(/\/+$/, ''));
    } catch {
      // fall through
    }
    return fail('must be an http(s) URL');
  };
  const postgresUrl = (raw: string) => {
    try {
      const url = new URL(raw);
      if (url.protocol === 'postgres:' || url.protocol === 'postgresql:') return ok(raw);
    } catch {
      // fall through
    }
    return fail('must be a postgres:// or postgresql:// URL');
  };
  const oneOf =
    <T extends string>(values: readonly T[]) =>
    (raw: string) =>
      (values as readonly string[]).includes(raw) ? ok(raw as T) : fail(`must be one of ${values.join(', ')}`);
  const bool = (raw: string) =>
    raw === 'true' ? ok(true) : raw === 'false' ? ok(false) : fail('must be true or false');
  const int = (min: number) => (raw: string) =>
    /^\d+$/.test(raw) && Number(raw) >= min ? ok(Number(raw)) : fail(`must be an integer >= ${min}`);
  const aesKey = (raw: string) => {
    if (!BASE64.test(raw)) return fail('must be 32 bytes encoded in base64');
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? ok(key) : fail(`must be 32 bytes encoded in base64 (got ${key.length} bytes)`);
  };

  const config = {
    discordToken: field('DISCORD_TOKEN', {}, text),
    discordClientId: field('DISCORD_CLIENT_ID', {}, snowflake),
    discordDevGuildId: field('DISCORD_DEV_GUILD_ID', { optional: true }, snowflake),
    databaseUrl: field('DATABASE_URL', {}, postgresUrl),
    publicBaseUrl: field('PUBLIC_BASE_URL', {}, httpUrl),
    bnetClientId: field('BNET_CLIENT_ID', {}, text),
    bnetClientSecret: field('BNET_CLIENT_SECRET', {}, text),
    bnetRedirectUri: field('BNET_REDIRECT_URI', {}, httpUrl),
    bnetDefaultRegion: field('BNET_DEFAULT_REGION', { fallback: 'eu' }, oneOf(REGIONS)),
    bnetPublicProfile: field('BNET_PUBLIC_PROFILE', { fallback: 'false' }, bool),
    heartbeatIntervalSec: field('HEARTBEAT_INTERVAL_SEC', { fallback: '600' }, int(MIN_HEARTBEAT_INTERVAL_SEC)),
    levelCap: field('LEVEL_CAP', { fallback: '60' }, int(1)),
    boardMinEditIntervalSec: field(
      'BOARD_MIN_EDIT_INTERVAL_SEC',
      { fallback: '15' },
      int(MIN_BOARD_EDIT_INTERVAL_SEC),
    ),
    appDownloadUrl: field('APP_DOWNLOAD_URL', {}, httpUrl),
    logLevel: field('LOG_LEVEL', { fallback: 'info' }, oneOf(LOG_LEVELS)),
    tokenEncKey: field('TOKEN_ENC_KEY', {}, aesKey),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config as AppConfig;
}
