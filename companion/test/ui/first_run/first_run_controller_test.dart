import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/device_pairing.dart';
import 'package:forevertracker_sync/settings/app_settings.dart';
import 'package:forevertracker_sync/settings/settings_store.dart';
import 'package:forevertracker_sync/settings/startup_launcher.dart';
import 'package:forevertracker_sync/ui/first_run/first_run_controller.dart';
import 'package:forevertracker_sync/wow_files/forever_folder.dart';
import 'package:http/http.dart' as http;

import '../../support/fake_server.dart';
import '../../support/memory_token_store.dart';
import '../../wow_files/wow_tree.dart';

class RecordingLauncher implements StartupLauncher {
  final calls = <bool>[];
  @override
  Future<void> setEnabled(bool enabled) async => calls.add(enabled);
}

void main() {
  late WowTree tree;
  late Directory tmp;
  late SettingsStore settings;
  late FakeServer server;
  late MemoryTokenStore tokens;
  late RecordingLauncher launcher;

  FirstRunController controllerFor({
    List<String>? candidates,
    AppSettings initial = const AppSettings(),
  }) => FirstRunController(
    locator: ForeverFolderLocator(candidates: candidates ?? [tree.forever]),
    pairing: DevicePairing(
      client: ApiClient(baseUrl: Uri.parse('https://api.example.test'), httpClient: server.client),
      store: tokens,
      deviceName: 'PC',
      appVersion: '1.0.0',
    ),
    settings: settings,
    startup: launcher,
    initial: initial,
  );

  setUp(() {
    tree = WowTree.create();
    tmp = Directory.systemTemp.createTempSync('ftsync_firstrun_');
    settings = SettingsStore(File(WowTree.p(tmp.path, 'settings.json')));
    server = FakeServer((_) => jsonResponse(201, pairBody()));
    tokens = MemoryTokenStore();
    launcher = RecordingLauncher();
  });

  tearDown(() {
    tree.delete();
    tmp.deleteSync(recursive: true);
  });

  test('shown only when the app is not paired', () {
    expect(shouldShowFirstRun(paired: false), isTrue);
    expect(shouldShowFirstRun(paired: true), isFalse);
  });

  group('game folder', () {
    test('detected folder is preselected', () async {
      tree.createWtf();
      final c = controllerFor();
      await c.init();
      expect(c.folder, tree.forever);
      expect(c.folderMessage, isNull);
    });

    test('a valid folder saved in settings wins over detection', () async {
      final other = WowTree.create();
      addTearDown(other.delete);
      other.createWtf();
      tree.createWtf();
      final c = controllerFor(initial: AppSettings(gameFolder: other.forever));
      await c.init();
      expect(c.folder, other.forever);
    });

    test('nothing detected: asks the player to choose', () async {
      final c = controllerFor(candidates: []);
      await c.init();
      expect(c.folder, isNull);
      expect(c.folderMessage, contains('Choisis'));
    });

    test('a chosen World of Warcraft folder resolves to _forever_', () async {
      tree.createWtf();
      final c = controllerFor(candidates: []);
      await c.init();
      await c.chooseFolder(tree.root);
      expect(c.folder, tree.forever);
      expect(c.folderMessage, isNull);
    });

    test('a chosen folder without _forever_\\WTF shows the problem', () async {
      final c = controllerFor(candidates: []);
      await c.init();
      await c.chooseFolder(tree.root);
      expect(c.folder, isNull);
      expect(c.folderMessage, ForeverFolderProblem.noForeverFolder.message);
    });
  });

  group('submit', () {
    late FirstRunController c;

    setUp(() async {
      tree.createWtf();
      c = controllerFor();
      await c.init();
    });

    test('"Démarrer avec Windows" is on by default', () {
      expect(c.startWithWindows, isTrue);
    });

    test('success stores the token and saves the settings, never the token', () async {
      c.setStartWithWindows(false);
      expect(await c.submit('k7p2 9qxm'), isTrue);
      expect(tokens.token?.value, sampleToken);
      expect(
        await settings.load(),
        AppSettings(gameFolder: tree.forever, startWithWindows: false, firstRunCompleted: true),
      );
      expect(launcher.calls, [false]);
      expect(settings.file.readAsStringSync(), isNot(contains(sampleToken)));
      expect(settings.file.readAsStringSync(), isNot(contains('K7P29QXM')));
      expect(c.error, isNull);
      expect(c.busy, isFalse);
    });

    test('no folder: refused before any request', () async {
      final none = controllerFor(candidates: []);
      await none.init();
      expect(await none.submit('K7P29QXM'), isFalse);
      expect(none.error, contains('dossier'));
      expect(server.requests, isEmpty);
    });

    test('malformed code: refused before any request', () async {
      expect(await c.submit('K7P2'), isFalse);
      expect(c.error, contains('8 caractères'));
      expect(server.requests, isEmpty);
    });

    final cases = <String, (http.Response, String)>{
      '404 code_unknown': (errorResponse(404, 'code_unknown'), 'Code inconnu'),
      '410 code_expired': (errorResponse(410, 'code_expired'), 'expiré'),
      '409 code_used': (errorResponse(409, 'code_used'), 'déjà servi'),
      '429 rate_limited': (
        errorResponse(429, 'rate_limited', headers: {'retry-after': '45'}),
        'Réessaie dans 45 s',
      ),
      '500': (http.Response('oops', 500), 'Le serveur'),
      '400 validation_failed': (errorResponse(400, 'validation_failed'), 'refusé'),
    };
    cases.forEach((name, value) {
      test('$name shows a French message and stores nothing', () async {
        server.respond = (_) => value.$1;
        expect(await c.submit('K7P29QXM'), isFalse);
        expect(c.error, contains(value.$2));
        expect(tokens.token, isNull);
        expect(await settings.file.exists(), isFalse);
        expect(c.busy, isFalse);
      });
    });

    test('every API error has a message', () {
      const all = <ApiException>[
        ApiNotConfigured(),
        NetworkError('x'),
        ServerError(503),
        UnexpectedResponse(418),
        InvalidToken(),
        ValidationFailed(),
        PayloadTooLarge(),
        SchemaRejected(),
        RateLimited(null),
        CodeUnknown(),
        CodeExpired(),
        CodeUsed(),
      ];
      for (final e in all) {
        expect(pairingErrorMessage(e), isNotEmpty, reason: '$e');
      }
      expect(pairingErrorMessage(const RateLimited(null)), contains('Réessaie dans'));
      expect(pairingErrorMessage(const NetworkError('x')), contains('injoignable'));
    });
  });
}
