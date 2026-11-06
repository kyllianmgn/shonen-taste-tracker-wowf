import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { toApiError } from './api-error';

/** Routes whose errors follow `error.json`. `/health` and the OAuth callback keep their own format. */
export const API_PREFIX = '/v1/';

/**
 * Global filter: under `/v1/`, every error with a contract code is answered as `error.json`
 * (plus `Retry-After` for 429). Everything else goes to Nest's default handler.
 */
@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const apiError = isApiPath(request.path) ? toApiError(exception) : null;
    if (!apiError) {
      super.catch(exception, host);
      return;
    }

    const response = http.getResponse<Response>();
    if (apiError.retryAfterSec !== undefined) response.setHeader('Retry-After', String(apiError.retryAfterSec));
    response.status(apiError.getStatus()).json(apiError.getResponse());
  }
}

function isApiPath(path: string | undefined): boolean {
  return typeof path === 'string' && path.startsWith(API_PREFIX);
}
