import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_client.dart';
import 'package:forevertracker_sync/api/device_pairing.dart';
import 'package:forevertracker_sync/settings/app_settings.dart';
import 'package:forevertracker_sync/settings/settings_store.dart';
import 'package:forevertracker_sync/settings/startup_launcher.dart';
import 'package:forevertracker_sync/ui/first_run/first_run_controller.dart';
import 'package:forevertracker_sync/ui/first_run/first_run_window.dart';
import 'package:forevertracker_sync/wow_files/forever_folder.dart';

import '../../support/fake_server.dart';
import '../../support/memory_token_store.dart';
import '../../wow_files/wow_tree.dart';

class NoopLauncher implements StartupLauncher {
  @override
  Future<void> setEnabled(bool enabled) async {}
}

void main() {
  late WowTree tree;
  late Directory tmp;
  late FakeServer server;
  late MemoryTokenStore tokens;

  FirstRunController controllerFor(List<String> candidates) => FirstRunController(
    locator: ForeverFolderLocator(candidates: candidates),
    pairing: DevicePairing(
      client: ApiClient(baseUrl: Uri.parse('https://api.example.test'), httpClient: server.client),
      store: tokens,
      deviceName: 'PC',
      appVersion: '1.0.0',
    ),
    settings: SettingsStore(File(WowTree.p(tmp.path, 'settings.json'))),
    startup: NoopLauncher(),
    initial: const AppSettings(),
  );

  setUp(() {
    tree = WowTree.create();
    tmp = Directory.systemTemp.createTempSync('ftsync_firstrun_ui_');
    server = FakeServer((_) => jsonResponse(201, pairBody()));
    tokens = MemoryTokenStore();
  });

  tearDown(() {
    tree.delete();
    tmp.deleteSync(recursive: true);
  });

  Future<void> pump(
    WidgetTester tester,
    FirstRunController c, {
    Future<String?> Function()? pick,
    VoidCallback? onPaired,
  }) async {
    await tester.runAsync(c.init);
    await tester.pumpWidget(
      MaterialApp(
        home: FirstRunWindow(
          controller: c,
          pickFolder: pick ?? () async => null,
          onPaired: onPaired ?? () {},
        ),
      ),
    );
  }

  testWidgets('shows the detected folder, the code field and the checkbox on', (tester) async {
    tree.createWtf();
    await pump(tester, controllerFor([tree.forever]));
    expect(find.text(tree.forever), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    final box = tester.widget<CheckboxListTile>(find.byType(CheckboxListTile));
    expect(box.value, isTrue);
    expect(find.text('Démarrer avec Windows'), findsOneWidget);
  });

  testWidgets('"Choisir…" opens the picker and validates the folder', (tester) async {
    tree.createWtf();
    var picks = 0;
    await pump(
      tester,
      controllerFor([]),
      pick: () async {
        picks++;
        return tree.root;
      },
    );
    expect(find.textContaining('Choisis'), findsWidgets);
    await tester.runAsync(() async {
      await tester.tap(find.text('Choisir…'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();
    expect(picks, 1);
    expect(find.text(tree.forever), findsOneWidget);
  });

  testWidgets('a valid code pairs and calls onPaired', (tester) async {
    tree.createWtf();
    var paired = 0;
    await pump(tester, controllerFor([tree.forever]), onPaired: () => paired++);
    await tester.enterText(find.byType(TextField), 'k7p29qxm');
    await tester.runAsync(() async {
      await tester.tap(find.text('Appairer'));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pump();
    expect(paired, 1);
    expect(tokens.token?.value, sampleToken);
  });

  testWidgets('a server error is shown and the window stays', (tester) async {
    tree.createWtf();
    server.respond = (_) => errorResponse(410, 'code_expired');
    var paired = 0;
    await pump(tester, controllerFor([tree.forever]), onPaired: () => paired++);
    await tester.enterText(find.byType(TextField), 'K7P29QXM');
    await tester.runAsync(() async {
      await tester.tap(find.text('Appairer'));
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pump();
    expect(paired, 0);
    expect(find.textContaining('expiré'), findsOneWidget);
  });
}
