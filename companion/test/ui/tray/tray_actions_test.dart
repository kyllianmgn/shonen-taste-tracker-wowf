import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/pairing_service.dart';
import 'package:forevertracker_sync/settings/app_settings.dart';
import 'package:forevertracker_sync/settings/settings_store.dart';
import 'package:forevertracker_sync/settings/startup_launcher.dart';
import 'package:forevertracker_sync/sync/sync_service.dart';
import 'package:forevertracker_sync/ui/tray/tray_actions.dart';
import 'package:forevertracker_sync/ui/tray/tray_menu.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart';

class Calls {
  final list = <String>[];
}

class FakeSync implements SyncService {
  FakeSync(this.c);
  final Calls c;
  @override
  Future<void> syncNow() async => c.list.add('syncNow');
}

class FakePairing implements PairingService {
  FakePairing(this.c);
  final Calls c;
  @override
  Future<bool> isPaired() async => false;
  @override
  Future<bool> pair() async {
    c.list.add('pair');
    return true;
  }

  @override
  Future<void> unpair() async => c.list.add('unpair');
}

class FakeLauncher implements StartupLauncher {
  FakeLauncher(this.c);
  final Calls c;
  @override
  Future<void> setEnabled(bool enabled) async => c.list.add('startup:$enabled');
}

void main() {
  late Directory tmp;
  late SettingsStore store;
  late Calls calls;
  late List<TrayEvent> events;
  late TrayActions actions;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('ftsync_actions_');
    store = SettingsStore(File('${tmp.path}${Platform.pathSeparator}settings.json'));
    calls = Calls();
    events = [];
    actions = TrayActions(
      sync: FakeSync(calls),
      pairing: FakePairing(calls),
      startup: FakeLauncher(calls),
      settings: store,
      openLogs: () async => calls.list.add('openLogs'),
      openUpdate: () async => calls.list.add('openUpdate'),
      quit: () async => calls.list.add('quit'),
      emit: events.add,
    );
  });

  tearDown(() => tmp.deleteSync(recursive: true));

  test('routes simple actions to their service', () async {
    await actions.handle(TrayAction.syncNow);
    await actions.handle(TrayAction.openLogs);
    await actions.handle(TrayAction.openUpdate);
    await actions.handle(TrayAction.quit);
    expect(calls.list, ['syncNow', 'openLogs', 'openUpdate', 'quit']);
  });

  test('pair emits Paired only when pairing succeeds', () async {
    await actions.handle(TrayAction.pair);
    expect(calls.list, ['pair']);
    expect(events.single, isA<Paired>());
  });

  test('unpair emits Unpaired', () async {
    await actions.handle(TrayAction.unpair);
    expect(calls.list, ['unpair']);
    expect(events.single, isA<Unpaired>());
  });

  test('toggling start with Windows updates the launcher and the settings', () async {
    await store.save(const AppSettings(gameFolder: 'x'));
    final after = await actions.handle(TrayAction.toggleStartWithWindows);
    expect(calls.list, ['startup:false']);
    expect(after?.startWithWindows, isFalse);
    expect(await store.load(), const AppSettings(gameFolder: 'x', startWithWindows: false));

    await actions.handle(TrayAction.toggleStartWithWindows);
    expect(calls.list.last, 'startup:true');
    expect((await store.load()).startWithWindows, isTrue);
  });
}
