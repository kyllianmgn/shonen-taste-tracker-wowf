import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BnetLinkService, type CallbackQuery } from './bnet-link.service';
import { renderCallbackPage, type CallbackPageKind } from './callback-page';

/** Redirect target of the Battle.net authorization (BNET_REDIRECT_URI). Answers a static page. */
@Controller('oauth/bnet')
export class OauthCallbackController {
  private readonly logger = new Logger(OauthCallbackController.name);

  constructor(private readonly link: BnetLinkService) {}

  @Get('callback')
  async callback(@Query() query: CallbackQuery, @Res() res: Response): Promise<void> {
    let kind: CallbackPageKind;
    try {
      kind = await this.link.complete(query);
    } catch (error) {
      // E.g. the database is down: still a page for the member, never Nest's JSON error.
      this.logger.error(`Battle.net callback failed: ${error instanceof Error ? error.message : String(error)}`);
      kind = 'failed';
    }
    const page = renderCallbackPage(kind);
    res
      .status(page.status)
      // The URL carries the code and the state: never cached, never sent on as a referrer.
      .set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
      })
      .type('html')
      .send(page.html);
  }
}
