import type { NestExpressApplication } from '@nestjs/platform-express';
import { SYNC_MAX_BODY_BYTES } from './ingest/sync/sync.types';

/**
 * HTTP settings shared by main.ts and the e2e tests.
 *
 * The service runs behind exactly one reverse proxy, Caddy (docs/02 « Docker »): trusting one hop
 * makes `req.ip` the client address from `X-Forwarded-For`, which the per-IP rate limit of
 * POST /v1/devices/pair needs (otherwise every client would share Caddy's address).
 *
 * JSON bodies may reach 512 KiB, the limit of POST /v1/sync (Express defaults to 100 KiB);
 * above it the API answers 413 payload_too_large.
 */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: SYNC_MAX_BODY_BYTES });
}
