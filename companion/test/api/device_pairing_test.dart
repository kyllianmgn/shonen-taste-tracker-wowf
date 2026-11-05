import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/device_pairing.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../support/contract.dart';
import '../support/fake_server.dart';
import '../support/memory_token_store.dart';

void main() {
  late FakeServer server;
  late MemoryTokenStore store;
  late DevicePairing pairing;

  setUp(() {
    server = FakeServer((_) => jsonResponse(201, pairBody()));
    store = MemoryTokenStore();
    pairing = DevicePairing(
      client: ApiClient(baseUrl: Uri.parse('https://api.example.test'), httpClient: server.client),
      store: store,
      deviceName: 'PC-salon',
      appVersion: '1.0.0',
    );
  });

  group('normalizePairingCode', () {
    test('uppercases and drops spaces and dashes', () {
      expect(normalizePairingCode(' k7p2-9qxm '), 'K7P29QXM');
      expect(normalizePairingCode('K7P2 9QXM'), 'K7P29QXM');
    });

    test('refuses ambiguous characters and wrong lengths', () {
      expect(normalizePairingCode('K7P29QX0'), isNull); // 0
      expect(normalizePairingCode('K7P29QXO'), isNull); // O
      expect(normalizePairingCode('K7P29QX1'), isNull); // 1
      expect(normalizePairingCode('K7P29QXI'), isNull); // I
      expect(normalizePairingCode('K7P29QX'), isNull);
      expect(normalizePairingCode('K7P29QXMM'), isNull);
      expect(normalizePairingCode(''), isNull);
    });
  });

  group('deviceNameFor', () {
    test('keeps a normal host name', () => expect(deviceNameFor('PC-salon'), 'PC-salon'));
    test('falls back when empty', () => expect(deviceNameFor('  '), 'PC Windows'));
    test('truncates to 64 characters and stays valid', () {
      final name = deviceNameFor('x' * 100);
      expect(name.length, 64);
      expect(
        contractErrors('pair.request', {
          'code': 'K7P29QXM',
          'deviceName': name,
          'appVersion': '1.0.0',
          'os': 'windows',
        }),
        isEmpty,
      );
    });
  });

  test('not paired until a pairing succeeds', () async {
    expect(await pairing.isPaired(), isFalse);
    expect(await pairing.token(), isNull);
  });

  test('pairWithCode sends a valid request and stores the token', () async {
    final res = await pairing.pairWithCode('k7p2-9qxm');
    expect(contractErrors('pair.request', server.lastJson), isEmpty);
    expect((server.lastJson as Map)['code'], 'K7P29QXM');
    expect((server.lastJson as Map)['deviceName'], 'PC-salon');
    expect(res.heartbeatIntervalSec, 600);
    expect(store.token, const DeviceToken(sampleToken));
    expect(await pairing.isPaired(), isTrue);
  });

  test('an invalid code is refused before any request', () async {
    await expectLater(pairing.pairWithCode('0000'), throwsArgumentError);
    expect(server.requests, isEmpty);
  });

  test('a server error stores nothing', () async {
    server.respond = (_) => errorResponse(410, 'code_expired');
    await expectLater(pairing.pairWithCode('K7P29QXM'), throwsA(isA<CodeExpired>()));
    expect(store.writes, 0);
    expect(await pairing.isPaired(), isFalse);
  });

  group('unpair', () {
    setUp(() => store.token = const DeviceToken(sampleToken));

    test('revokes the device on the server, then forgets the token', () async {
      server.respond = (_) => http.Response('', 204);
      await pairing.unpair();
      expect(server.last.method, 'DELETE');
      expect(server.last.url.path, '/v1/devices/me');
      expect(store.token, isNull);
    });

    test('forgets the token even when the server already revoked it', () async {
      server.respond = (_) => errorResponse(401, 'invalid_token');
      await pairing.unpair();
      expect(store.token, isNull);
    });

    test('forgets the token even when the server is unreachable', () async {
      final offline = DevicePairing(
        client: ApiClient(
          baseUrl: Uri.parse('https://api.example.test'),
          httpClient: MockClient((_) async => throw http.ClientException('down')),
        ),
        store: store,
        deviceName: 'PC',
        appVersion: '1.0.0',
      );
      await offline.unpair();
      expect(store.token, isNull);
    });

    test('does nothing on the server when not paired', () async {
      store.token = null;
      await pairing.unpair();
      expect(server.requests, isEmpty);
    });
  });
}
