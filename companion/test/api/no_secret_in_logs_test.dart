import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/api/device_pairing.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/app/rotating_file_sink.dart';
import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import '../support/fake_server.dart';
import '../support/memory_token_store.dart';

const code = 'K7P29QXM';

void main() {
  late List<String> lines;
  late StreamSubscription<LogRecord> sub;

  setUp(() {
    lines = [];
    Logger.root.level = Level.ALL;
    sub = Logger.root.onRecord.listen((r) => lines.add(formatLogRecord(r)));
  });

  tearDown(() async {
    await sub.cancel();
    Logger.root.level = Level.INFO;
  });

  test('DeviceToken never prints its value', () {
    const t = DeviceToken(sampleToken);
    expect(t.toString(), isNot(contains(sampleToken)));
    expect('$t', isNot(contains(sampleToken)));
    expect(t.toString(), isNot(contains('SECRET')));
  });

  test('no token nor pairing code in the logs, on success or failure', () async {
    // The server echoes the secrets back in every error message, the worst case.
    var status = 201;
    final server = FakeServer((r) {
      if (status == 201) return jsonResponse(201, pairBody());
      return jsonResponse(status, {
        'error': {'code': 'validation_failed', 'message': 'bad $code ${r.headers['authorization']}'},
      });
    });
    final store = MemoryTokenStore();
    final client = ApiClient(baseUrl: Uri.parse('https://api.example.test'), httpClient: server.client);
    final pairing = DevicePairing(client: client, store: store, deviceName: 'PC', appVersion: '1.0.0');
    final errors = <Object>[];

    await pairing.pairWithCode(code);
    final token = (await pairing.token())!;
    await client.heartbeat(
      token,
      const HeartbeatRequest(sentAt: 1, gameRunning: true, appVersion: '1.0.0'),
    );
    for (status in [400, 401, 409, 429, 500]) {
      try {
        await pairing.pairWithCode(code);
      } on ApiException catch (e) {
        errors.add(e);
      }
      try {
        await client.sync(
          token,
          const SyncRequest(sentAt: 1, schema: 1, addonVersion: '0.1.0', characters: []),
        );
      } on ApiException catch (e) {
        errors.add(e);
      }
    }
    server.respond = (_) => http.Response('', 204);
    await pairing.unpair();

    expect(errors, hasLength(10));
    expect(lines, isNotEmpty, reason: 'the client is expected to log its calls');
    final everything = [...lines, ...errors.map((e) => e.toString())].join('\n');
    expect(everything, isNot(contains(sampleToken)));
    expect(everything, isNot(contains(code)));
  });

  test('a network error message does not leak the Authorization header', () async {
    final client = ApiClient(
      baseUrl: Uri.parse('https://api.example.test'),
      httpClient: FakeServer((r) => throw SocketException('failed ${r.headers}')).client,
    );
    try {
      await client.deleteDevice(const DeviceToken(sampleToken));
      fail('expected a NetworkError');
    } on NetworkError catch (e) {
      expect(e.toString(), isNot(contains(sampleToken)));
    }
    expect(lines.join('\n'), isNot(contains(sampleToken)));
  });
}
