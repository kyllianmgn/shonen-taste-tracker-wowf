/// Typed failures of the API client, one per `code` of `contract/schemas/error.json`
/// plus the transport cases.
///
/// No subclass keeps the server's `message` or the raw transport error: they may
/// echo the request (pairing code, Authorization header) and these objects are
/// logged.
sealed class ApiException implements Exception {
  const ApiException(this.status);

  /// HTTP status, or null when no response was received.
  final int? status;

  /// Network, 5xx and 429 go to the offline queue (C-07); the rest never succeed by retrying.
  bool get retryable => false;

  String get _name;

  @override
  String toString() => status == null ? 'ApiException($_name)' : 'ApiException($_name, $status)';
}

/// `API_BASE_URL` missing or invalid in this build: nothing was sent.
class ApiNotConfigured extends ApiException {
  const ApiNotConfigured() : super(null);
  @override
  String get _name => 'not_configured';
}

/// No response: DNS, refused connection, TLS, timeout.
class NetworkError extends ApiException {
  const NetworkError(this.kind) : super(null);

  /// Exception type only, never its message.
  final String kind;

  @override
  bool get retryable => true;
  @override
  String get _name => 'network:$kind';
}

/// 5xx.
class ServerError extends ApiException {
  const ServerError(int super.status);
  @override
  bool get retryable => true;
  @override
  String get _name => 'server_error';
}

/// A status or a body the contract does not describe.
class UnexpectedResponse extends ApiException {
  const UnexpectedResponse(int super.status);
  @override
  String get _name => 'unexpected_response';
}

/// 400 `validation_failed`.
class ValidationFailed extends ApiException {
  const ValidationFailed() : super(400);
  @override
  String get _name => 'validation_failed';
}

/// 401 `invalid_token`: the device token was revoked.
class InvalidToken extends ApiException {
  const InvalidToken() : super(401);
  @override
  String get _name => 'invalid_token';
}

/// 404 `code_unknown`.
class CodeUnknown extends ApiException {
  const CodeUnknown() : super(404);
  @override
  String get _name => 'code_unknown';
}

/// 409 `code_used`.
class CodeUsed extends ApiException {
  const CodeUsed() : super(409);
  @override
  String get _name => 'code_used';
}

/// 410 `code_expired`.
class CodeExpired extends ApiException {
  const CodeExpired() : super(410);
  @override
  String get _name => 'code_expired';
}

/// 413 `payload_too_large`.
class PayloadTooLarge extends ApiException {
  const PayloadTooLarge() : super(413);
  @override
  String get _name => 'payload_too_large';
}

/// 422 `unknown_schema`: the server does not know the SavedVariables `schema`.
class SchemaRejected extends ApiException {
  const SchemaRejected() : super(422);
  @override
  String get _name => 'unknown_schema';
}

/// 429 `rate_limited`.
class RateLimited extends ApiException {
  const RateLimited(this.retryAfter) : super(429);

  /// From the `Retry-After` header; null when absent or unreadable.
  final Duration? retryAfter;

  @override
  bool get retryable => true;
  @override
  String get _name => 'rate_limited';
}
