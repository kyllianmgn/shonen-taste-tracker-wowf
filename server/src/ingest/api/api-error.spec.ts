import { BadRequestException, HttpException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ContractValidator } from '../../common/contract/contract-validator';
import { API_ERROR_STATUS, ApiError, toApiError, validationError } from './api-error';

const contract = new ContractValidator();

describe('ApiError', () => {
  it('maps every code of error.json to the status of docs/02 « Erreurs » and « Appairage »', () => {
    expect(API_ERROR_STATUS).toEqual({
      validation_failed: 400,
      invalid_token: 401,
      code_unknown: 404,
      code_used: 409,
      code_expired: 410,
      payload_too_large: 413,
      unknown_schema: 422,
      rate_limited: 429,
    });
  });

  it.each(Object.keys(API_ERROR_STATUS) as (keyof typeof API_ERROR_STATUS)[])(
    'builds a body valid against error.json, with a French default message, for %s',
    (code) => {
      const error = new ApiError(code);

      expect(error.getStatus()).toBe(API_ERROR_STATUS[code]);
      expect(contract.validate('error', error.getResponse())).toEqual({ ok: true });
      expect((error.getResponse() as { error: { message: string } }).error.message).not.toBe('');
    },
  );

  it('keeps a custom message within the 512 characters of error.json', () => {
    const error = new ApiError('validation_failed', { message: 'x'.repeat(600) });

    expect(contract.validate('error', error.getResponse())).toEqual({ ok: true });
  });

  it('carries the Retry-After delay of a rate_limited error', () => {
    expect(new ApiError('rate_limited', { retryAfterSec: 12 }).retryAfterSec).toBe(12);
  });
});

describe('validationError', () => {
  it('lists the offending paths in the message', () => {
    const error = validationError([
      { path: '/code', message: 'must match pattern "^[A-HJ-NP-Z2-9]{8}$"' },
      { path: '/os', message: 'must be one of: windows, macos' },
    ]);

    expect(error.code).toBe('validation_failed');
    const { message } = (error.getResponse() as { error: { message: string } }).error;
    expect(message).toContain('/code');
    expect(message).toContain('/os');
  });
});

describe('toApiError', () => {
  it('returns an ApiError unchanged', () => {
    const error = new ApiError('code_used');
    expect(toApiError(error)).toBe(error);
  });

  it.each([
    [new BadRequestException('Unexpected token'), 'validation_failed'],
    [new HttpException('nope', 401), 'invalid_token'],
    [new PayloadTooLargeException(), 'payload_too_large'],
    [new HttpException('slow down', 429), 'rate_limited'],
  ])('translates %p into %s', (exception, code) => {
    expect(toApiError(exception)?.code).toBe(code);
  });

  it('translates body-parser errors (malformed JSON, body too large)', () => {
    const malformed = Object.assign(new SyntaxError('Unexpected token'), { status: 400, type: 'entity.parse.failed' });
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });

    expect(toApiError(malformed)?.code).toBe('validation_failed');
    expect(toApiError(tooLarge)?.code).toBe('payload_too_large');
  });

  it('leaves statuses without a contract code to the default handler', () => {
    expect(toApiError(new NotFoundException())).toBeNull();
    expect(toApiError(new Error('boom'))).toBeNull();
  });
});
