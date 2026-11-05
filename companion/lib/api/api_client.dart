import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import 'api_error.dart';
import 'api_models.dart';
import 'device_token.dart';

/// HTTP client for the four endpoints of the exchange contract (docs/02).
///
/// Every failure is an [ApiException]. Logs carry the method, path and status
/// only: never a body, a header, the token or the pairing code.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required http.Client httpClient,
    this.timeout = const Duration(seconds: 30),
    DateTime Function()? now,
  }) : _http = httpClient,
       _now = now ?? DateTime.now;

  /// From `--dart-define=API_BASE_URL` (see `parseApiBaseUrl`); null when missing.
  final Uri? baseUrl;
  final Duration timeout;
  final http.Client _http;
  final DateTime Function() _now;

  static final _log = Logger('api');

  Future<PairResponse> pair(PairRequest request) =>
      _send('POST', '/v1/devices/pair', body: request.toJson(), parse: PairResponse.fromJson);

  Future<HeartbeatResponse> heartbeat(DeviceToken token, HeartbeatRequest request) => _send(
    'POST',
    '/v1/heartbeat',
    token: token,
    body: request.toJson(),
    parse: HeartbeatResponse.fromJson,
  );

  Future<SyncResponse> sync(DeviceToken token, SyncRequest request) =>
      _send('POST', '/v1/sync', token: token, body: request.toJson(), parse: SyncResponse.fromJson);

  /// Revokes this device on the server ("Délier").
  Future<void> deleteDevice(DeviceToken token) =>
      _send<void>('DELETE', '/v1/devices/me', token: token, parse: null);

  /// Sends one request. [parse] reads a 2xx JSON body; null means the body is ignored.
  Future<T> _send<T>(
    String method,
    String path, {
    DeviceToken? token,
    Map<String, Object?>? body,
    required T Function(Object? json)? parse,
  }) async {
    final base = baseUrl;
    if (base == null) {
      _log.severe('$method $path: API_BASE_URL is not set in this build');
      throw const ApiNotConfigured();
    }
    final request = http.Request(method, base.replace(path: '${base.path}$path'))
      ..headers['accept'] = 'application/json';
    if (token != null) request.headers['authorization'] = 'Bearer ${token.value}';
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.bodyBytes = utf8.encode(jsonEncode(body));
    }

    final http.Response response;
    try {
      response = await () async {
        return http.Response.fromStream(await _http.send(request));
      }().timeout(timeout);
    } on Object catch (e) {
      final kind = switch (e) {
        TimeoutException() => 'timeout',
        SocketException() => 'socket',
        HandshakeException() => 'tls',
        http.ClientException() => 'client',
        _ => null,
      };
      if (kind == null) rethrow;
      _log.warning('$method $path failed: $kind');
      throw NetworkError(kind);
    }

    final status = response.statusCode;
    if (status >= 200 && status < 300) {
      _log.fine('$method $path -> $status');
      if (parse == null) return null as T;
      try {
        return parse(jsonDecode(utf8.decode(response.bodyBytes)));
      } on FormatException catch (e) {
        _log.warning('$method $path -> $status with a body outside the contract: ${e.message}');
        throw UnexpectedResponse(status);
      }
    }

    final error = _errorFor(status, response);
    _log.warning('$method $path -> $error');
    throw error;
  }

  ApiException _errorFor(int status, http.Response response) {
    final code = _errorCode(response);
    return switch ((status, code)) {
      (_, 'validation_failed') => const ValidationFailed(),
      (_, 'invalid_token') || (401, null) => const InvalidToken(),
      (_, 'code_unknown') => const CodeUnknown(),
      (_, 'code_used') => const CodeUsed(),
      (_, 'code_expired') => const CodeExpired(),
      (_, 'payload_too_large') || (413, null) => const PayloadTooLarge(),
      (_, 'unknown_schema') => const SchemaRejected(),
      (_, 'rate_limited') ||
      (429, null) => RateLimited(_retryAfter(response.headers['retry-after'])),
      _ when status >= 500 => ServerError(status),
      _ => UnexpectedResponse(status),
    };
  }

  /// The `error.code` of an `error.json` body; null when the body is not one.
  static String? _errorCode(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map && decoded['error'] is Map) {
        final code = (decoded['error'] as Map)['code'];
        if (code is String && _knownCodes.contains(code)) return code;
      }
    } on FormatException {
      // Not JSON: a proxy page, for instance.
    }
    return null;
  }

  static const _knownCodes = {
    'validation_failed',
    'invalid_token',
    'payload_too_large',
    'unknown_schema',
    'rate_limited',
    'code_unknown',
    'code_expired',
    'code_used',
  };

  /// `Retry-After` is either delay-seconds or an HTTP date (RFC 9110).
  Duration? _retryAfter(String? header) {
    if (header == null) return null;
    final value = header.trim();
    final seconds = int.tryParse(value);
    if (seconds != null) return seconds < 0 ? null : Duration(seconds: seconds);
    try {
      final delay = HttpDate.parse(value).difference(_now());
      return delay.isNegative ? Duration.zero : delay;
    } on HttpException {
      return null;
    } on FormatException {
      return null;
    }
  }
}
