import { TEST_DATABASE_URL } from './test-database';

// Fake but well-formed configuration for e2e runs. No real secret here.
Object.assign(process.env, {
  DISCORD_TOKEN: 'test-discord-token',
  DISCORD_CLIENT_ID: '100000000000000001',
  DATABASE_URL: TEST_DATABASE_URL,
  PUBLIC_BASE_URL: 'http://localhost:3000',
  BNET_CLIENT_ID: 'test-bnet-client',
  BNET_CLIENT_SECRET: 'test-bnet-secret',
  BNET_REDIRECT_URI: 'http://localhost:3000/oauth/bnet/callback',
  APP_DOWNLOAD_URL: 'https://example.org/releases',
  TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  LOG_LEVEL: 'error',
});
