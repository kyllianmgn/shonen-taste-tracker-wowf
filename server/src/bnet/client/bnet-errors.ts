/**
 * Typed errors of the Battle.net client. Messages carry the route and status only:
 * never a token, a client secret or a response body.
 */
export class BnetError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The token endpoint refused the client credentials or failed. */
export class BnetAuthError extends BnetError {}

/** 401 / 403: the token is invalid, expired or lacks the scope. */
export class BnetUnauthorizedError extends BnetError {}

/** 404: e.g. an account without any Forever character, or an unknown realm. */
export class BnetNotFoundError extends BnetError {}

/** Still 429 after the allowed retries. */
export class BnetRateLimitedError extends BnetError {}

/** Any other failure: unexpected status, network error or malformed body. */
export class BnetHttpError extends BnetError {}
