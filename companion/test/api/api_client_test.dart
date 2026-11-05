import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/lua/saved_variables.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../support/contract.dart';
import '../support/fake_server.dart';

const token = DeviceToken(sampleToken);
final now = DateTime.utc(2026, 11, 5, 12);

ApiClient clientFor(FakeServer server, {String base = 'https://api.example.test'}) =>
    ApiClient(baseUrl: Uri.parse(base), httpClient: server.client, now: () => now);

const pairRequest = PairRequest(code: 'K7P29QXM', deviceName: 'PC-salon', appVersion: '0.1.0');

const heartbeatRunning = HeartbeatRequest(
  sentAt: 1793899000,
  gameRunning: true,
  appVersion: '0.1.0',
  lastCharacter: CharacterRef(region: 'eu', firstName: 'Davina', surname: 'Asaria'),
);

SyncRequest syncFromSample() {
  final data = parseSavedVariablesBytes(
    savedVariablesFixture('ForeverTracker.sample.lua'),
    contractSchemaJson('sync.request'),
  )!;
  return SyncRequest(
    sentAt: 1793900000,
    schema: data.schema! as int,
    addonVersion: data.addonVersion! as String,
    characters: data.characters,
  );
}

final syncOkBody = {
  'heartbeatIntervalSec': 600,
  'results': [
    {
      'key': {'region': 'eu', 'firstName': 'Davina', 'surname': 'Asaria'},
      'status': 'ok',
      'acceptedEvents': 2,
      'duplicateEvents': 0,
      'flags': <String>[],
    },
    {
      'key': {'region': 'eu', 'firstName': 'Morwen', 'surname': 'Asaria'},
      'status': 'owned_by_other',
      'acceptedEvents': 0,
      'duplicateEvents': 0,
      'flags': <String>[],
    },
  ],
};

void main() {
  group('request bodies match contract/schemas', () {
    test('the validator rejects a broken body (control)', () {
      expect(contractErrors('pair.request', {'code': 'k7p29qxm'}), isNotEmpty);
      expect(
        contractErrors('heartbeat.request', {'sentAt': 1, 'gameRunning': true, 'appVersion': 'x', 'extra': 1}),
        isNotEmpty,
      );
    });

    test('pair', () async {
      final server = FakeServer((_) => jsonResponse(201, pairBody()));
      await clientFor(server).pair(pairRequest);
      expect(contractErrors('pair.request', server.lastJson), isEmpty);
      expect(server.lastJson, {
        'code': 'K7P29QXM',
        'deviceName': 'PC-salon',
        'appVersion': '0.1.0',
        'os': 'windows',
      });
    });

    test('heartbeat with and without lastCharacter, as in the fixtures', () async {
      final server = FakeServer((_) => jsonResponse(200, {'heartbeatIntervalSec': 600, 'serverTime': 1}));
      final client = clientFor(server);

      await client.heartbeat(token, heartbeatRunning);
      expect(contractErrors('heartbeat.request', server.lastJson), isEmpty);
      expect(server.lastJson, contractFixture('heartbeat.running.json'));

      await client.heartbeat(
        token,
        const HeartbeatRequest(sentAt: 1793900700, gameRunning: false, appVersion: '0.1.0'),
      );
      expect(contractErrors('heartbeat.request', server.lastJson), isEmpty);
      expect((server.lastJson as Map).containsKey('lastCharacter'), isFalse);
    });

    test('sync built from the sample SavedVariables', () async {
      final server = FakeServer((_) => jsonResponse(200, syncOkBody));
      await clientFor(server).sync(token, syncFromSample());
      expect(contractErrors('sync.request', server.lastJson), isEmpty);
      expect((server.lastJson as Map)['characters'], hasLength(2));
    });

    test('sync carries the fixture payload unchanged', () async {
      final fixture = contractFixture('sync.valid.json');
      final server = FakeServer((_) => jsonResponse(200, syncOkBody));
      await clientFor(server).sync(
        token,
        SyncRequest(
          sentAt: fixture['sentAt']! as int,
          schema: fixture['schema']! as int,
          addonVersion: fixture['addonVersion']! as String,
          characters: fixture['characters']! as List<Object?>,
        ),
      );
      expect(server.lastJson, fixture);
      expect(contractErrors('sync.request', server.lastJson), isEmpty);
    });
  });

  group('HTTP details', () {
    test('pair: POST /v1/devices/pair, JSON, no Authorization', () async {
      final server = FakeServer((_) => jsonResponse(201, pairBody()));
      final res = await clientFor(server).pair(pairRequest);
      expect(server.last.method, 'POST');
      expect(server.last.url.toString(), 'https://api.example.test/v1/devices/pair');
      expect(server.last.headers['content-type'], startsWith('application/json'));
      expect(server.last.headers.containsKey('authorization'), isFalse);
      expect(res.deviceId, sampleDeviceId);
      expect(res.deviceToken.value, sampleToken);
      expect(res.heartbeatIntervalSec, 600);
    });

    test('heartbeat and sync send the bearer token and parse the response', () async {
      final server = FakeServer(
        (r) => r.url.path.endsWith('/heartbeat')
            ? jsonResponse(200, {'heartbeatIntervalSec': 300, 'serverTime': 1793900002})
            : jsonResponse(200, syncOkBody),
      );
      final client = clientFor(server);

      final hb = await client.heartbeat(token, heartbeatRunning);
      expect(server.last.url.path, '/v1/heartbeat');
      expect(server.last.headers['authorization'], 'Bearer $sampleToken');
      expect(hb.heartbeatIntervalSec, 300);
      expect(hb.serverTime, 1793900002);

      final sync = await client.sync(token, syncFromSample());
      expect(server.last.url.path, '/v1/sync');
      expect(server.last.headers['authorization'], 'Bearer $sampleToken');
      expect(sync.heartbeatIntervalSec, 600);
      expect(sync.results.map((r) => r.status), [SyncStatus.ok, SyncStatus.ownedByOther]);
      expect(sync.results.first.key, const CharacterRef(region: 'eu', firstName: 'Davina', surname: 'Asaria'));
      expect(sync.results.first.acceptedEvents, 2);
    });

    test('deleteDevice: DELETE /v1/devices/me with the bearer token', () async {
      final server = FakeServer((_) => http.Response('', 204));
      await clientFor(server).deleteDevice(token);
      expect(server.last.method, 'DELETE');
      expect(server.last.url.path, '/v1/devices/me');
      expect(server.last.headers['authorization'], 'Bearer $sampleToken');
    });

    test('keeps a path prefix of the base URL', () async {
      final server = FakeServer((_) => jsonResponse(201, pairBody()));
      await clientFor(server, base: 'http://localhost:3000/api').pair(pairRequest);
      expect(server.last.url.toString(), 'http://localhost:3000/api/v1/devices/pair');
    });

    test('without a base URL every call fails with ApiNotConfigured, nothing is sent', () async {
      final server = FakeServer((_) => jsonResponse(201, pairBody()));
      final client = ApiClient(baseUrl: null, httpClient: server.client);
      await expectLater(client.pair(pairRequest), throwsA(isA<ApiNotConfigured>()));
      await expectLater(client.deleteDevice(token), throwsA(isA<ApiNotConfigured>()));
      expect(server.requests, isEmpty);
    });
  });

  group('typed errors (error.json)', () {
    Future<ApiException> failure(http.Response response, {bool withToken = true}) async {
      final client = clientFor(FakeServer((_) => response));
      try {
        if (withToken) {
          await client.heartbeat(token, heartbeatRunning);
        } else {
          await client.pair(pairRequest);
        }
      } on ApiException catch (e) {
        return e;
      }
      throw StateError('expected an ApiException');
    }

    test('error bodies used below are valid error.json', () {
      for (final code in ['invalid_token', 'code_unknown', 'code_expired', 'code_used', 'rate_limited']) {
        expect(contractErrors('error', {'error': {'code': code, 'message': 'm'}}), isEmpty);
      }
    });

    test('404 code_unknown, 410 code_expired, 409 code_used', () async {
      expect(await failure(errorResponse(404, 'code_unknown'), withToken: false), isA<CodeUnknown>());
      expect(await failure(errorResponse(410, 'code_expired'), withToken: false), isA<CodeExpired>());
      expect(await failure(errorResponse(409, 'code_used'), withToken: false), isA<CodeUsed>());
    });

    test('401 invalid_token, even without a JSON body', () async {
      expect(await failure(errorResponse(401, 'invalid_token')), isA<InvalidToken>());
      expect(await failure(http.Response('Unauthorized', 401)), isA<InvalidToken>());
    });

    test('400, 413 and 422 map to their codes', () async {
      expect(await failure(errorResponse(400, 'validation_failed')), isA<ValidationFailed>());
      expect(await failure(errorResponse(413, 'payload_too_large')), isA<PayloadTooLarge>());
      expect(await failure(errorResponse(422, 'unknown_schema')), isA<SchemaRejected>());
    });

    test('429 with Retry-After in seconds', () async {
      final e = await failure(errorResponse(429, 'rate_limited', headers: {'retry-after': '42'}));
      expect(e, isA<RateLimited>());
      expect((e as RateLimited).retryAfter, const Duration(seconds: 42));
    });

    test('429 with Retry-After as an HTTP date', () async {
      final at = HttpDate.format(now.add(const Duration(minutes: 2)));
      final e = await failure(errorResponse(429, 'rate_limited', headers: {'retry-after': at}));
      expect((e as RateLimited).retryAfter, const Duration(minutes: 2));
    });

    test('429 without, or with a broken, Retry-After', () async {
      expect((await failure(errorResponse(429, 'rate_limited')) as RateLimited).retryAfter, isNull);
      final broken = await failure(errorResponse(429, 'rate_limited', headers: {'retry-after': 'soon'}));
      expect((broken as RateLimited).retryAfter, isNull);
      final past = HttpDate.format(now.subtract(const Duration(minutes: 1)));
      final late = await failure(errorResponse(429, 'rate_limited', headers: {'retry-after': past}));
      expect((late as RateLimited).retryAfter, Duration.zero);
    });

    test('5xx is a ServerError, an unknown 4xx an UnexpectedResponse', () async {
      final e = await failure(http.Response('<html>bad gateway</html>', 502));
      expect(e, isA<ServerError>());
      expect(e.status, 502);
      expect(await failure(http.Response('nope', 418)), isA<UnexpectedResponse>());
      expect(await failure(errorResponse(404, 'not_a_code')), isA<UnexpectedResponse>());
    });

    test('a 2xx body that does not match the contract is an UnexpectedResponse', () async {
      expect(await failure(jsonResponse(200, {'serverTime': 1})), isA<UnexpectedResponse>());
      expect(await failure(http.Response('not json', 200)), isA<UnexpectedResponse>());
      expect(
        await failure(jsonResponse(201, {'deviceId': 'x', 'heartbeatIntervalSec': 600}), withToken: false),
        isA<UnexpectedResponse>(),
      );
    });

    test('network failure and timeout are NetworkErrors', () async {
      final down = ApiClient(
        baseUrl: Uri.parse('https://api.example.test'),
        httpClient: MockClient((_) async => throw http.ClientException('connection refused')),
      );
      await expectLater(down.heartbeat(token, heartbeatRunning), throwsA(isA<NetworkError>()));

      final slow = ApiClient(
        baseUrl: Uri.parse('https://api.example.test'),
        httpClient: MockClient((_) => Completer<http.Response>().future),
        timeout: const Duration(milliseconds: 20),
      );
      await expectLater(slow.heartbeat(token, heartbeatRunning), throwsA(isA<NetworkError>()));
    });

    test('only network, 5xx and 429 are retryable (offline queue, C-07)', () async {
      expect(const NetworkError('x').retryable, isTrue);
      expect(const ServerError(503).retryable, isTrue);
      expect(const RateLimited(null).retryable, isTrue);
      expect(const InvalidToken().retryable, isFalse);
      expect(const ValidationFailed().retryable, isFalse);
      expect(const CodeExpired().retryable, isFalse);
    });
  });
}
