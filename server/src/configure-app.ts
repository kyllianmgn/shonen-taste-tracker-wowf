import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * HTTP settings shared by main.ts and the e2e tests.
 *
 * The service runs behind exactly one reverse proxy, Caddy (docs/02 « Docker »): trusting one hop
 * makes `req.ip` the client address from `X-Forwarded-For`, which the per-IP rate limit of
 * POST /v1/devices/pair needs (otherwise every client would share Caddy's address).
 */
export function configureApp(app: NestExpressApplication): void {
  app.set('trust proxy', 1);
}
