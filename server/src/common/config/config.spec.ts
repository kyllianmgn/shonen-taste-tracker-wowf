import { randomBytes } from 'node:crypto';
import { ConfigError, loadConfig } from './config';

const KEY_32 = randomBytes(32).toString('base64');

function validEnv(): Record<string, string> {
  return {
    DISCORD_TOKEN: 'discord-token-value',
    DISCORD_CLIENT_ID: '123456789012345678',
    DATABASE_URL: 'postgresql://ft:pw@db:5432/ft',
    PUBLIC_BASE_URL: 'https://ft.example.org',
    BNET_CLIENT_ID: 'bnet-client-id',
    BNET_CLIENT_SECRET: 'bnet-client-secret',
    BNET_REDIRECT_URI: 'https://ft.example.org/oauth/bnet/callback',
    APP_DOWNLOAD_URL: 'https://github.com/example/forever-tracker/releases',
    TOKEN_ENC_KEY: KEY_32,
  };
}

function errorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('parses a complete environment and applies defaults', () => {
    const config = loadConfig(validEnv());

    expect(config).toEqual({
      discordToken: 'discord-token-value',
      discordClientId: '123456789012345678',
      discordDevGuildId: undefined,
      databaseUrl: 'postgresql://ft:pw@db:5432/ft',
      publicBaseUrl: 'https://ft.example.org',
      bnetClientId: 'bnet-client-id',
      bnetClientSecret: 'bnet-client-secret',
      bnetRedirectUri: 'https://ft.example.org/oauth/bnet/callback',
      bnetDefaultRegion: 'eu',
      bnetPublicProfile: false,
      heartbeatIntervalSec: 600,
      levelCap: 60,
      boardMinEditIntervalSec: 15,
      appDownloadUrl: 'https://github.com/example/forever-tracker/releases',
      logLevel: 'info',
      tokenEncKey: Buffer.from(KEY_32, 'base64'),
    });
  });

  it('reads optional variables when present', () => {
    const config = loadConfig({
      ...validEnv(),
      DISCORD_DEV_GUILD_ID: '987654321098765432',
      BNET_DEFAULT_REGION: 'us',
      BNET_PUBLIC_PROFILE: 'true',
      HEARTBEAT_INTERVAL_SEC: '300',
      LEVEL_CAP: '70',
      BOARD_MIN_EDIT_INTERVAL_SEC: '30',
      LOG_LEVEL: 'debug',
      PUBLIC_BASE_URL: 'https://ft.example.org/',
    });

    expect(config.discordDevGuildId).toBe('987654321098765432');
    expect(config.bnetDefaultRegion).toBe('us');
    expect(config.bnetPublicProfile).toBe(true);
    expect(config.heartbeatIntervalSec).toBe(300);
    expect(config.levelCap).toBe(70);
    expect(config.boardMinEditIntervalSec).toBe(30);
    expect(config.logLevel).toBe('debug');
    expect(config.publicBaseUrl).toBe('https://ft.example.org');
  });

  it.each([
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DATABASE_URL',
    'PUBLIC_BASE_URL',
    'BNET_CLIENT_ID',
    'BNET_CLIENT_SECRET',
    'BNET_REDIRECT_URI',
    'APP_DOWNLOAD_URL',
    'TOKEN_ENC_KEY',
  ])('rejects a missing %s', (name) => {
    const env: Record<string, string | undefined> = validEnv();
    delete env[name];

    const error = errorOf(env);

    expect(error.problems).toEqual([`${name} is required`]);
    expect(error.message).toContain(`${name} is required`);
  });

  it('treats blank values as missing', () => {
    expect(errorOf({ ...validEnv(), DISCORD_TOKEN: '   ' }).problems).toEqual([
      'DISCORD_TOKEN is required',
    ]);
  });

  it.each([
    ['TOKEN_ENC_KEY', randomBytes(16).toString('base64'), 'TOKEN_ENC_KEY must be 32 bytes encoded in base64 (got 16 bytes)'],
    ['TOKEN_ENC_KEY', 'not base64 at all!', 'TOKEN_ENC_KEY must be 32 bytes encoded in base64'],
    ['DISCORD_CLIENT_ID', 'abc', 'DISCORD_CLIENT_ID must be a Discord snowflake (17-20 digits)'],
    ['DISCORD_DEV_GUILD_ID', '12', 'DISCORD_DEV_GUILD_ID must be a Discord snowflake (17-20 digits)'],
    ['DATABASE_URL', 'mysql://x@y/z', 'DATABASE_URL must be a postgres:// or postgresql:// URL'],
    ['PUBLIC_BASE_URL', 'ft.example.org', 'PUBLIC_BASE_URL must be an http(s) URL'],
    ['BNET_REDIRECT_URI', 'ftp://x/y', 'BNET_REDIRECT_URI must be an http(s) URL'],
    ['APP_DOWNLOAD_URL', 'releases', 'APP_DOWNLOAD_URL must be an http(s) URL'],
    ['BNET_DEFAULT_REGION', 'fr', 'BNET_DEFAULT_REGION must be one of eu, us, kr, tw'],
    ['BNET_PUBLIC_PROFILE', 'yes', 'BNET_PUBLIC_PROFILE must be true or false'],
    ['HEARTBEAT_INTERVAL_SEC', '0', 'HEARTBEAT_INTERVAL_SEC must be an integer >= 30'],
    ['HEARTBEAT_INTERVAL_SEC', '10.5', 'HEARTBEAT_INTERVAL_SEC must be an integer >= 30'],
    ['LEVEL_CAP', 'sixty', 'LEVEL_CAP must be an integer >= 1'],
    ['BOARD_MIN_EDIT_INTERVAL_SEC', '5', 'BOARD_MIN_EDIT_INTERVAL_SEC must be an integer >= 15'],
    ['LOG_LEVEL', 'loud', 'LOG_LEVEL must be one of fatal, error, warn, info, debug, verbose'],
  ])('rejects a malformed %s (%s)', (name, value, expected) => {
    const error = errorOf({ ...validEnv(), [name]: value });

    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain(expected);
  });

  it('reports every problem at once, in a readable message', () => {
    const error = errorOf({ ...validEnv(), DISCORD_TOKEN: undefined, LEVEL_CAP: 'x', TOKEN_ENC_KEY: 'AAAA' });

    expect(error.problems).toHaveLength(3);
    expect(error.message).toMatch(/^Invalid configuration \(3 problems\):\n/);
    expect(error.message).toContain('\n  - DISCORD_TOKEN is required');
  });

  it('never echoes secret values in the message', () => {
    const shortKey = randomBytes(8).toString('base64');
    const error = errorOf({ ...validEnv(), TOKEN_ENC_KEY: shortKey, DATABASE_URL: 'mysql://user:hunter2@h/db' });

    expect(error.message).not.toContain(shortKey);
    expect(error.message).not.toContain('hunter2');
  });
});
