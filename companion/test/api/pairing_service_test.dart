import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/device_pairing.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/api/pairing_service.dart';
import 'package:http/http.dart' as http;

import '../support/fake_server.dart';
import '../support/memory_token_store.dart';

void main() {
  late MemoryTokenStore store;
  late FakeServer server;
  late int windowsShown;
  late WindowPairingService service;

  setUp(() {
    store = MemoryTokenStore();
    server = FakeServer((_) => http.Response('', 204));
    windowsShown = 0;
    service = WindowPairingService(
      pairing: DevicePairing(
        client: ApiClient(baseUrl: Uri.parse('https://api.example.test'), httpClient: server.client),
        store: store,
        deviceName: 'PC',
        appVersion: '1.0.0',
      ),
      showPairingWindow: () async {
        windowsShown++;
        store.token = const DeviceToken(sampleToken);
        return true;
      },
    );
  });

  test('isPaired reflects the token store', () async {
    expect(await service.isPaired(), isFalse);
    store.token = const DeviceToken(sampleToken);
    expect(await service.isPaired(), isTrue);
  });

  test('pair (tray "Appairer") opens the pairing window and returns its outcome', () async {
    expect(await service.pair(), isTrue);
    expect(windowsShown, 1);
  });

  test('unpair (tray "Délier") revokes the device and forgets the token', () async {
    store.token = const DeviceToken(sampleToken);
    await service.unpair();
    expect(server.last.method, 'DELETE');
    expect(store.token, isNull);
  });
}
