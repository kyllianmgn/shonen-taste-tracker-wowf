import { HttpException } from '@nestjs/common';
import type { ContractError } from '../../common/contract/contract-validator';

/**
 * Errors of the `/v1` API, in the format of `contract/schemas/error.json`:
 * `{ "error": { "code": "…", "message": "…" } }` (docs/02 « Erreurs » and « Appairage »).
 * Messages are French: the companion app may show them as is.
 */

export const API_ERROR_STATUS = {
  validation_failed: 400,
  invalid_token: 401,
  code_unknown: 404,
  code_used: 409,
  code_expired: 410,
  payload_too_large: 413,
  unknown_schema: 422,
  rate_limited: 429,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  validation_failed: 'Requête invalide.',
  invalid_token: 'Appareil non reconnu ou révoqué. Relie l’appli avec /lier appli.',
  code_unknown: 'Code inconnu. Vérifie-le ou demande-en un nouveau avec /lier appli.',
  code_used: 'Ce code a déjà servi. Demande-en un nouveau avec /lier appli.',
  code_expired: 'Ce code a expiré. Demande-en un nouveau avec /lier appli.',
  payload_too_large: 'Envoi trop volumineux.',
  unknown_schema: 'Version de données inconnue. Mets l’appli à jour.',
  rate_limited: 'Trop de requêtes. Réessaie plus tard.',
};

/** `message` max length in error.json. */
const MAX_MESSAGE_LENGTH = 512;

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export class ApiError extends HttpException {
  readonly code: ApiErrorCode;
  /** Seconds sent in `Retry-After` (rate_limited only). */
  readonly retryAfterSec?: number;

  constructor(code: ApiErrorCode, opts: { message?: string; retryAfterSec?: number } = {}) {
    const message = truncate(opts.message ?? DEFAULT_MESSAGES[code]);
    const body: ApiErrorBody = { error: { code, message } };
    super(body, API_ERROR_STATUS[code]);
    this.code = code;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/** 400 validation_failed listing the offending fields of a contract validation. */
export function validationError(errors: readonly ContractError[]): ApiError {
  const details = errors.map((e) => `${e.path} ${e.message}`).join(' ; ');
  return new ApiError('validation_failed', { message: `Requête invalide : ${details}` });
}

/** Statuses raised outside our code (Nest, body-parser) that have a contract code. */
const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'validation_failed',
  401: 'invalid_token',
  413: 'payload_too_large',
  429: 'rate_limited',
};

/**
 * Translates any thrown value into an ApiError, or null when the contract has no code for it
 * (unknown route, internal error): those keep Nest's default answer.
 */
export function toApiError(exception: unknown): ApiError | null {
  if (exception instanceof ApiError) return exception;
  const status = statusOf(exception);
  const code = status === undefined ? undefined : CODE_BY_STATUS[status];
  return code ? new ApiError(code) : null;
}

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  // body-parser errors (malformed JSON, body too large) carry `status` and `type`.
  if (exception instanceof Error && 'type' in exception && 'status' in exception) {
    const { status } = exception as { status: unknown };
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function truncate(message: string): string {
  return message.length <= MAX_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}
